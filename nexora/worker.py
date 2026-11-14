import hashlib
import json
import logging
import random
import signal
import time
from datetime import UTC, datetime
from threading import Event, Thread
from uuid import UUID, uuid4

from pydantic import TypeAdapter, ValidationError

from nexora.adapters import deliver
from nexora.broker import QUEUE, connect
from nexora.db import engine, one, run
from nexora.domain import ROUTES
from nexora.domain import Event as Envelope

adapter = TypeAdapter(Envelope)
log = logging.getLogger("nexora")
MAX_BODY = 32768
MAX_CALLS = 4


def parse_message(raw: bytes):
    digest = hashlib.sha256(raw).hexdigest()
    if len(raw) > MAX_BODY:
        return uuid4(), digest, {"bytes": len(raw)}, None, "BODY_TOO_LARGE"
    try:
        payload = json.loads(
            raw, parse_constant=lambda token: (_ for _ in ()).throw(ValueError(token))
        )
        # PostgreSQL jsonb does not accept NUL or lone surrogate code points.
        canonical = json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        canonical.encode("utf-8")
        if "\\u0000" in canonical:
            raise ValueError("NUL")
        digest = hashlib.sha256(canonical.encode()).hexdigest()
    except (ValueError, RecursionError):
        return uuid4(), digest, {"bytes": len(raw)}, None, "INVALID_JSON"
    try:
        event = adapter.validate_json(raw)
    except ValidationError:
        # Keep validation metadata without retaining arbitrary untrusted values.
        return uuid4(), digest, {"bytes": len(raw)}, None, "INVALID_CONTRACT"
    return event.id, digest, payload, event, None


def ingest(raw: bytes):
    identifier, digest, payload, event, rejection = parse_message(raw)
    fields = (
        {
            "source": event.source,
            "kind": event.type,
            "version": event.version,
            "customer": event.customer_id,
            "correlation": event.correlation_id,
        }
        if event
        else {
            "source": None,
            "kind": None,
            "version": None,
            "customer": None,
            "correlation": None,
        }
    )
    with engine().begin() as conn:
        if rejection:
            run(
                conn,
                "SELECT pg_advisory_xact_lock(hashtextextended(:hash,0))",
                hash=digest,
            )
            if one(
                conn,
                "SELECT id FROM events WHERE digest=:digest AND rejection=:rejection LIMIT 1",
                digest=digest,
                rejection=rejection,
            ):
                return
        item = one(
            conn,
            """INSERT INTO events(id,correlation_id,customer_id,source,type,version,payload,digest,rejection)
                   VALUES (:id,:correlation,:customer,:source,:kind,:version,CAST(:payload AS jsonb),:digest,:rejection)
                   ON CONFLICT(id) DO NOTHING RETURNING id""",
            id=identifier,
            digest=digest,
            payload=json.dumps(payload),
            rejection=rejection,
            **fields,
        )
        if item is None:
            existing = one(
                conn, "SELECT digest FROM events WHERE id=:id", id=identifier
            )
            if existing["digest"] != digest:
                rejected_id = UUID(
                    bytes=hashlib.sha256(f"{identifier}:{digest}".encode()).digest()[
                        :16
                    ]
                )
                run(
                    conn,
                    """INSERT INTO events(id,correlation_id,customer_id,source,type,version,payload,digest,rejection)
                    VALUES (:id,:correlation,:customer,:source,:kind,:version,'{}'::jsonb,:digest,'EVENT_ID_CONFLICT')
                    ON CONFLICT(id) DO NOTHING""",
                    id=rejected_id,
                    digest=digest,
                    **fields,
                )
        elif event is not None:
            for target in ROUTES[event.type]:
                run(
                    conn,
                    "INSERT INTO deliveries(event_id,target) VALUES (:id,:target)",
                    id=identifier,
                    target=target,
                )


def consume(stop: Event):
    while not stop.is_set():
        try:
            connection, channel = connect()
            try:
                while not stop.is_set():
                    method, _, body = channel.basic_get(QUEUE, auto_ack=False)
                    if method is None:
                        connection.process_data_events(time_limit=0.2)
                        continue
                    ingest(body)
                    channel.basic_ack(method.delivery_tag)
            finally:
                if connection.is_open:
                    connection.close()
        except Exception as error:
            log.warning(
                json.dumps(
                    {"event": "consumer_reconnect", "class": type(error).__name__}
                )
            )
            stop.wait(1)


def process_delivery(target: str):
    with engine().begin() as conn:
        item = one(
            conn,
            """SELECT d.*,e.payload,e.correlation_id FROM deliveries d JOIN events e ON e.id=d.event_id
                    WHERE d.target=:target AND d.status IN ('PENDING','RETRY') AND d.next_at<=clock_timestamp()
                    ORDER BY d.next_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED""",
            target=target,
        )
        if item is None:
            return False
        started = datetime.now(UTC)
        timer = time.monotonic()
        result = deliver(item["payload"], target)
        duration = int((time.monotonic() - timer) * 1000)
        calls = item["calls"] + 1
        delay = 0.0
        if result.code in {"APPLIED", "SAME", "STALE"}:
            state = "SUCCEEDED"
        elif result.retry and calls < MAX_CALLS:
            state = "RETRY"
            delay = 2 ** (calls - 1) + random.uniform(0, 0.5)
        else:
            state = "DEAD"
        run(
            conn,
            """INSERT INTO attempts(delivery_id,generation,number,started_at,duration_ms,http_status,outcome)
                     VALUES (:id,:generation,:number,:started,:duration,:http_status,:outcome)""",
            id=item["id"],
            generation=item["generation"],
            number=calls,
            started=started,
            duration=duration,
            http_status=result.status,
            outcome=result.code,
        )
        run(
            conn,
            """UPDATE deliveries SET calls=:calls,status=:status,outcome=:outcome,
                     next_at=clock_timestamp()+(:delay * interval '1 second') WHERE id=:id""",
            calls=calls,
            status=state,
            outcome=result.code,
            delay=delay,
            id=item["id"],
        )
    log.info(
        json.dumps(
            {
                "event": "delivery_attempt",
                "event_id": str(item["event_id"]),
                "delivery_id": str(item["id"]),
                "correlation_id": str(item["correlation_id"]),
                "target": target,
                "status": state,
                "outcome": result.code,
                "duration_ms": duration,
            }
        )
    )
    return True


def dispatch(stop, target):
    while not stop.is_set():
        try:
            if not process_delivery(target):
                stop.wait(0.2)
        except Exception as error:
            log.error(
                json.dumps(
                    {
                        "event": "dispatch_error",
                        "target": target,
                        "class": type(error).__name__,
                    }
                )
            )
            stop.wait(1)


def main():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("pika").setLevel(logging.CRITICAL)
    stop = Event()

    def shutdown(*_):
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, shutdown)
    tasks = [
        Thread(target=consume, args=(stop,)),
        *(
            Thread(target=dispatch, args=(stop, target))
            for target in ("ERP", "CRM", "Billing")
        ),
    ]
    for task in tasks:
        task.start()
    for task in tasks:
        task.join()


if __name__ == "__main__":
    main()
