from uuid import UUID

from fastapi import HTTPException

from nexora.db import one, run
from nexora.domain import Payment, PaymentProjection, Profile, make_event


def outbox(conn, event):
    run(
        conn,
        "INSERT INTO outbox(id,payload) VALUES (:id,CAST(:payload AS jsonb))",
        id=event.id,
        payload=event.model_dump_json(),
    )


def save_profile(
    conn, data: Profile, correlation: UUID, customer_id: UUID | None = None
):
    if customer_id is None:
        record = one(
            conn,
            """INSERT INTO customers(name,email,version) VALUES (:name,:email,1)
                           RETURNING *""",
            **data.model_dump(),
        )
    else:
        record = one(
            conn,
            """UPDATE customers SET name=:name,email=:email,version=version+1
                          WHERE id=:id RETURNING *""",
            id=customer_id,
            **data.model_dump(),
        )
    if record is None:
        raise HTTPException(404, "CUSTOMER_MISSING")
    event = make_event(record["id"], record["version"], data, correlation)
    outbox(conn, event)
    return {"record": record, "event_id": event.id, "correlation_id": correlation}


def republish_profile(conn, customer_id: UUID, correlation: UUID):
    record = one(conn, "SELECT * FROM customers WHERE id=:id FOR SHARE", id=customer_id)
    if record is None:
        raise HTTPException(404, "CUSTOMER_MISSING")
    event = make_event(
        customer_id,
        record["version"],
        Profile(name=record["name"], email=record["email"]),
        correlation,
    )
    outbox(conn, event)
    return {"record": record, "event_id": event.id, "correlation_id": correlation}


def register_payment(conn, customer_id: UUID, data: Payment, correlation: UUID):
    record = one(
        conn,
        """UPDATE contracts SET payment_status=:status,payment_version=payment_version+1
                      WHERE id=:id RETURNING *""",
        id=customer_id,
        status=data.status,
    )
    if record is None:
        raise HTTPException(404, "CONTRACT_MISSING")
    event = make_event(customer_id, record["payment_version"], data, correlation)
    outbox(conn, event)
    return {"record": record, "event_id": event.id, "correlation_id": correlation}


def compare_projection(current, version, field_values, version_field="version"):
    if current[version_field] > version:
        return "STALE"
    if current[version_field] == version:
        if any(current[name] != value for name, value in field_values.items()):
            raise HTTPException(409, "VERSION_CONFLICT")
        return "SAME"
    return "APPLIED"


def sync_profile(
    conn,
    table: str,
    customer_id: UUID,
    version: int,
    name: str,
    email: str | None = None,
):
    assert table in {"contracts", "partners"}
    columns = {"name": name}
    if table == "contracts":
        columns["email"] = email
    names = ", ".join(columns)
    params = ", ".join(":" + name for name in columns)
    inserted = one(
        conn,
        f"""INSERT INTO {table}(id,version,{names}) VALUES (:id,:version,{params})
                         ON CONFLICT(id) DO NOTHING RETURNING id""",
        id=customer_id,
        version=version,
        **columns,
    )
    if inserted:
        return "APPLIED"
    current = one(
        conn, f"SELECT * FROM {table} WHERE id=:id FOR UPDATE", id=customer_id
    )
    result = compare_projection(current, version, columns)
    if result == "APPLIED":
        assignments = ",".join(f"{field}=:{field}" for field in columns)
        run(
            conn,
            f"UPDATE {table} SET version=:version,{assignments} WHERE id=:id",
            id=customer_id,
            version=version,
            **columns,
        )
    return result


def sync_payment(conn, customer_id: UUID, data: PaymentProjection):
    current = one(
        conn, "SELECT * FROM customers WHERE id=:id FOR UPDATE", id=customer_id
    )
    if current is None:
        raise HTTPException(404, "CUSTOMER_MISSING")
    result = compare_projection(
        current, data.version, {"payment_status": data.status}, "payment_version"
    )
    if result == "APPLIED":
        run(
            conn,
            "UPDATE customers SET payment_status=:status,payment_version=:version WHERE id=:id",
            id=customer_id,
            **data.model_dump(),
        )
    return result


def read_projection(conn, table: str, identifier: UUID):
    assert table in {"customers", "contracts", "partners"}
    record = one(conn, f"SELECT * FROM {table} WHERE id=:id", id=identifier)
    if record is None:
        raise HTTPException(404, "RECORD_MISSING")
    return record
