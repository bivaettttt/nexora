from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from nexora.adapters import ADDRESSES, mapping, request
from nexora.auth import console, lab_admin, operator
from nexora.broker import connect, publish
from nexora.db import engine, one, rows, run
from nexora.domain import ROUTES, Payment, Profile, Strict
from nexora.operations import message, reconcile, repair, replay, target_result
from nexora.rest_models import CustomerRecord, Publication, Reconciliation
from nexora.source import Switch

app = FastAPI(title="Nexora Integration API", version="1.0.0")
Read = Annotated[str, Depends(console)]
Write = Annotated[str, Depends(operator)]
Lab = Annotated[str, Depends(lab_admin)]


@app.exception_handler(httpx.TransportError)
async def unavailable(_request: Request, _error: httpx.TransportError):
    return JSONResponse({"detail": "SOURCE_UNAVAILABLE"}, status_code=502)


@app.get("/health")
def health():
    with engine().connect() as conn:
        run(conn, "SELECT 1")
    return {"status": "ok"}


@app.get("/api/me")
def me(role: Read):
    import os

    return {"role": role, "lab": role == "admin" and os.getenv("LAB_MODE") == "1"}


@app.get("/api/systems")
def systems(role: Read):
    result = []
    for target, address in ADDRESSES.items():
        try:
            alive = request(
                target, "GET", "/health" if target == "CRM" else "/ready"
            ).is_success
        except httpx.TransportError:
            alive = False
        result.append(
            {
                "name": target,
                "endpoint": address,
                "protocol": "SOAP 1.1" if target == "ERP" else "REST",
                "reachable": alive,
                "contract": "partner.wsdl"
                if target == "ERP"
                else target.lower() + ".openapi.json",
            }
        )
    return result


@app.get("/api/routes")
def routes(role: Read):
    return [
        {
            "event": kind,
            "source": "CRM" if kind.endswith("profile") else "Billing",
            "version": 1,
            "targets": targets,
        }
        for kind, targets in ROUTES.items()
    ]


@app.get("/api/stats")
def stats(role: Read):
    with engine().connect() as conn:
        summary = one(
            conn,
            """SELECT count(*) AS events, count(*) FILTER (WHERE rejection IS NOT NULL) AS rejected
                              FROM events""",
        )
        states = rows(
            conn,
            "SELECT target,status,count(*) AS count FROM deliveries GROUP BY target,status ORDER BY target,status",
        )
        latency = one(
            conn,
            """SELECT avg(duration_ms)::int AS mean_ms,
                      percentile_disc(.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms FROM attempts""",
        )
    return {**summary, "states": states, **latency}


@app.get("/api/messages")
def messages(
    role: Read,
    event_id: UUID | None = None,
    correlation_id: UUID | None = None,
    source: Literal["CRM", "Billing"] | None = None,
    kind: Literal["customer.profile", "customer.payment"] | None = None,
    target: Literal["CRM", "ERP", "Billing"] | None = None,
    status: Literal["PENDING", "RETRY", "SUCCEEDED", "DEAD"] | None = None,
    since: datetime | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    with engine().connect() as conn:
        return rows(
            conn,
            """SELECT e.id,e.correlation_id,e.customer_id,e.source,e.type,e.version,e.rejection,e.received_at,
                   (SELECT count(*) FROM deliveries d WHERE d.event_id=e.id AND d.status='SUCCEEDED') AS succeeded,
                   (SELECT count(*) FROM deliveries d WHERE d.event_id=e.id) AS total
                   FROM events e WHERE (CAST(:id AS uuid) IS NULL OR e.id=:id)
                   AND (CAST(:correlation AS uuid) IS NULL OR e.correlation_id=:correlation)
                   AND (CAST(:source AS text) IS NULL OR e.source=:source)
                   AND (CAST(:kind AS text) IS NULL OR e.type=:kind)
                   AND (CAST(:since AS timestamptz) IS NULL OR e.received_at>=:since)
                   AND ((CAST(:target AS text) IS NULL AND CAST(:status AS text) IS NULL)
                   OR EXISTS (SELECT 1 FROM deliveries d WHERE d.event_id=e.id
                     AND (CAST(:target AS text) IS NULL OR d.target=:target)
                     AND (CAST(:status AS text) IS NULL OR d.status=:status)))
                   ORDER BY e.received_at DESC,e.id DESC LIMIT 50 OFFSET :offset""",
            id=event_id,
            correlation=correlation_id,
            source=source,
            kind=kind,
            since=since,
            target=target,
            status=status,
            offset=offset,
        )


@app.get("/api/messages/{identifier}")
def details(identifier: UUID, role: Read):
    result = message(identifier)
    if result is None:
        raise HTTPException(404, "MESSAGE_MISSING")
    for item in result["deliveries"]:
        item["transformation"] = mapping(result["event"]["payload"], item["target"])
    return result


@app.get("/api/errors")
def errors(
    role: Read, dead_only: bool = False, offset: Annotated[int, Query(ge=0)] = 0
):
    with engine().connect() as conn:
        return rows(
            conn,
            """SELECT e.id AS event_id,e.correlation_id,e.received_at,d.id AS delivery_id,d.target,
                   COALESCE(e.rejection,d.outcome) AS code,
                   COALESCE(d.status,'QUARANTINED') AS status
                   FROM events e LEFT JOIN deliveries d ON e.id=d.event_id
                   WHERE e.rejection IS NOT NULL OR d.status='DEAD' OR (NOT :dead AND d.status='RETRY')
                   ORDER BY e.received_at DESC,e.id DESC,d.id LIMIT 50 OFFSET :offset""",
            dead=dead_only,
            offset=offset,
        )


@app.post("/api/deliveries/{identifier}/replay", status_code=202)
def recover(identifier: UUID, role: Write):
    result = replay(identifier, role)
    if result is None:
        raise HTTPException(409, "DELIVERY_NOT_DEAD")
    return result


@app.get("/api/customers", response_model=list[CustomerRecord])
def customers(role: Read):
    return target_result(request("CRM", "GET", "/v1/customers"))


@app.post("/api/customers", status_code=201, response_model=Publication)
def create(payload: Profile, role: Write):
    return target_result(
        request("CRM", "POST", "/v1/customers", json=payload.model_dump())
    )


@app.put("/api/customers/{customer}", response_model=Publication)
def update(customer: UUID, payload: Profile, role: Write):
    return target_result(
        request("CRM", "PUT", f"/v1/customers/{customer}", json=payload.model_dump())
    )


@app.post(
    "/api/customers/{customer}/payment", status_code=201, response_model=Publication
)
def payment(customer: UUID, payload: Payment, role: Write):
    return target_result(
        request(
            "Billing",
            "POST",
            f"/v1/customers/{customer}/payments",
            json=payload.model_dump(),
        )
    )


@app.get("/api/reconciliation/{customer}", response_model=Reconciliation)
def check(customer: UUID, role: Read):
    return reconcile(customer)


@app.post(
    "/api/reconciliation/{customer}/repair", status_code=202, response_model=Publication
)
def repair_profile(customer: UUID, role: Write):
    return repair(customer, role)


@app.put("/api/lab/availability/{target}")
def availability(target: Literal["ERP", "Billing"], payload: Switch, role: Lab):
    return target_result(
        request(target, "PUT", "/v1/lab/availability", json=payload.model_dump())
    )


class LabInput(Strict):
    event_id: UUID | None = None


@app.post("/api/lab/publish/{scenario}", status_code=202)
def inject(
    scenario: Literal["duplicate", "stale", "invalid"], payload: LabInput, role: Lab
):
    if scenario == "invalid":
        event = {"schema_version": 999, "invalid_case": str(uuid4())}
    else:
        item = message(payload.event_id) if payload.event_id else None
        if not item or item["event"]["rejection"]:
            raise HTTPException(404, "MESSAGE_MISSING")
        event = item["event"]["payload"]
        if scenario == "stale":
            if event["version"] <= 1:
                raise HTTPException(409, "USE_VERSION_2_OR_HIGHER")
            event = {**event, "id": str(uuid4()), "version": event["version"] - 1}
    try:
        connection, channel = connect()
        try:
            channel.confirm_delivery()
            publish(channel, event)
        finally:
            connection.close()
    except Exception as error:
        raise HTTPException(503, "BROKER_UNAVAILABLE") from error
    return {
        "published": scenario,
        "event_id": event.get("id"),
        "correlation_id": event.get("correlation_id"),
    }


@app.get("/api/broker")
def broker(role: Read):
    import os

    from nexora.broker import QUEUE

    try:
        response = httpx.get(
            "http://rabbitmq:15672/api/queues/%2F/" + QUEUE,
            auth=("nexora", os.environ["BROKER_PASSWORD"]),
            timeout=2,
            trust_env=False,
        )
        if response.status_code == 404:
            return {"available": True, "ready": 0, "unacked": 0}
        response.raise_for_status()
        data = response.json()
        return {
            "available": True,
            "ready": data.get("messages_ready", 0),
            "unacked": data.get("messages_unacknowledged", 0),
        }
    except httpx.HTTPError:
        return {"available": False, "ready": None, "unacked": None}
