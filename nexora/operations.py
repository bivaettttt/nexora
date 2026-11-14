from uuid import uuid4

import httpx
from fastapi import HTTPException
from lxml import etree
from pydantic import ValidationError

from nexora.adapters import read_remote, request
from nexora.db import engine, one, rows, run
from nexora.rest_models import CustomerRecord, ServiceRecord

FIELDS = {"ERP": ("name",), "Billing": ("name", "email")}


def reconcile(customer):
    snapshots = {}
    issues = []
    for target in ("CRM", "ERP", "Billing"):
        try:
            record = read_remote(target, str(customer))
            if record is not None:
                record = (
                    (ServiceRecord if target == "ERP" else CustomerRecord)
                    .model_validate(record)
                    .model_dump(mode="json")
                )
        except (ValidationError, ValueError, etree.LxmlError):
            record = None
            issues.append({"target": target, "code": "CONTRACT", "field": None})
        except httpx.HTTPError:
            record = None
            issues.append({"target": target, "code": "UNREACHABLE"})
        else:
            if record is None:
                issues.append({"target": target, "code": "MISSING"})
            elif record["id"] != str(customer):
                issues.append({"target": target, "code": "IDENTIFIER_MISMATCH"})
        snapshots[target] = record

    crm = snapshots["CRM"]
    if crm:
        for target, fields in FIELDS.items():
            record = snapshots[target]
            if record:
                if record["version"] != crm["version"]:
                    issues.append(
                        {
                            "target": target,
                            "code": "VERSION_LAG"
                            if record["version"] < crm["version"]
                            else "AHEAD",
                        }
                    )
                for field in fields:
                    if record[field] != crm[field]:
                        issues.append(
                            {"target": target, "code": "FIELD_DRIFT", "field": field}
                        )
        billing = snapshots["Billing"]
        if (
            billing
            and billing["payment_version"]
            and any(
                crm[field] != billing[field]
                for field in ("payment_status", "payment_version")
            )
        ):
            issues.append({"target": "CRM", "code": "PAYMENT_DRIFT"})
    return {"customer_id": customer, "records": snapshots, "issues": issues}


def target_result(response):
    if response.status_code >= 500:
        raise HTTPException(502, "SOURCE_UNAVAILABLE")
    if response.is_error:
        raise HTTPException(
            response.status_code, response.json().get("detail", "SOURCE_ERROR")
        )
    return response.json()


def repair(customer, role):
    correlation = uuid4()
    result = target_result(
        request(
            "CRM",
            "POST",
            f"/v1/customers/{customer}/republish",
            correlation=correlation,
        )
    )
    with engine().begin() as conn:
        run(
            conn,
            "INSERT INTO actions(role,action,object_id) VALUES (:role,'RECONCILE_PROFILE',:id)",
            role=role,
            id=customer,
        )
    return result


def message(identifier):
    with (
        engine().connect().execution_options(isolation_level="REPEATABLE READ") as conn
    ):
        event = one(conn, "SELECT * FROM events WHERE id=:id", id=identifier)
        if event is None:
            return None
        deliveries = rows(
            conn,
            "SELECT * FROM deliveries WHERE event_id=:id ORDER BY target",
            id=identifier,
        )
        for item in deliveries:
            item["attempts"] = rows(
                conn,
                "SELECT * FROM attempts WHERE delivery_id=:id ORDER BY id",
                id=item["id"],
            )
        related = rows(
            conn,
            """SELECT id,type,received_at FROM events WHERE id<>:id AND
                       (correlation_id=:correlation OR customer_id=:customer)
                       ORDER BY received_at DESC LIMIT 20""",
            id=identifier,
            correlation=event["correlation_id"],
            customer=event["customer_id"],
        )
    return {"event": event, "deliveries": deliveries, "related": related}


def replay(delivery_id, role):
    with engine().begin() as conn:
        delivery = one(
            conn,
            """UPDATE deliveries SET status='PENDING', generation=generation+1, calls=0,
                           outcome=NULL, next_at=clock_timestamp() WHERE id=:id AND status='DEAD'
                           RETURNING *""",
            id=delivery_id,
        )
        if delivery:
            run(
                conn,
                "INSERT INTO actions(role,action,object_id) VALUES (:role,'REPLAY',:id)",
                role=role,
                id=delivery_id,
            )
        return delivery
