import json
import logging
import os
from threading import Event

import pika

from nexora.db import engine, one, run

QUEUE = "nexora.events"
log = logging.getLogger("nexora")


def connect():
    params = pika.URLParameters(os.environ["AMQP_URL"])
    params.socket_timeout = 3
    params.stack_timeout = 5
    params.blocked_connection_timeout = 5
    params.heartbeat = 20
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    channel.queue_declare(queue=QUEUE, durable=True)
    return connection, channel


def publish(channel, payload):
    channel.basic_publish(
        exchange="",
        routing_key=QUEUE,
        mandatory=True,
        body=json.dumps(payload, ensure_ascii=False).encode(),
        properties=pika.BasicProperties(
            content_type="application/json",
            delivery_mode=2,
            message_id=str(payload.get("id", "")),
            correlation_id=str(payload.get("correlation_id", "")),
        ),
    )


def relay(stop: Event):
    while not stop.is_set():
        try:
            connection, channel = connect()
            try:
                channel.confirm_delivery()
                while not stop.is_set():
                    connection.process_data_events(time_limit=0)
                    with engine().begin() as conn:
                        item = one(
                            conn,
                            """SELECT id,payload FROM outbox WHERE sent_at IS NULL
                                          ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED""",
                        )
                        if item:
                            publish(channel, item["payload"])
                            run(
                                conn,
                                "UPDATE outbox SET sent_at=clock_timestamp() WHERE id=:id",
                                id=item["id"],
                            )
                    if not item:
                        stop.wait(0.25)
            finally:
                if connection.is_open:
                    connection.close()
        except Exception as error:
            log.warning(
                json.dumps(
                    {"event": "relay_reconnect", "error_class": type(error).__name__}
                )
            )
            stop.wait(1)
