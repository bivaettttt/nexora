import os
from contextlib import asynccontextmanager
from threading import Event, Thread
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException

from nexora.auth import internal
from nexora.broker import relay
from nexora.db import engine, one, run
from nexora.domain import Payment, PaymentProjection, Profile, ProfileProjection, Strict
from nexora.projections import (
    read_projection,
    register_payment,
    republish_profile,
    save_profile,
    sync_payment,
    sync_profile,
)
from nexora.rest_models import CustomerRecord, ProjectionResult, Publication

Correlation = Annotated[UUID | None, Header(alias="X-Correlation-ID")]


class Switch(Strict):
    unavailable: bool


def install_fault_control(app):
    @app.get("/ready")
    def ready():
        with engine().connect() as conn:
            check_availability(conn)
        return {"status": "ok"}

    @app.put("/v1/lab/availability", dependencies=[Depends(internal)])
    def control(payload: Switch):
        if os.getenv("LAB_MODE") != "1":
            raise HTTPException(403, "LAB_DISABLED")
        with engine().begin() as conn:
            run(
                conn,
                "UPDATE controls SET unavailable=:value WHERE id=1",
                value=payload.unavailable,
            )
        return payload


def check_availability(conn):
    if one(conn, "SELECT unavailable FROM controls WHERE id=1")["unavailable"]:
        raise HTTPException(503, "SERVICE_UNAVAILABLE")


@asynccontextmanager
async def lifecycle(app):
    stop = Event()
    thread = Thread(target=relay, args=(stop,), daemon=True)
    thread.start()
    yield
    stop.set()
    thread.join(timeout=6)


def create_source(component: str):
    crm = component == "crm"
    app = FastAPI(
        title="Nexora " + ("CRM" if crm else "Billing"),
        version="1.0.0",
        lifespan=lifecycle,
    )
    secured = [Depends(internal)]
    table = "customers" if crm else "contracts"

    @app.get("/health")
    def health():
        with engine().connect() as conn:
            run(conn, "SELECT 1")
        return {"status": "ok"}

    @app.get(
        "/v1/customers/{customer_id}",
        dependencies=secured,
        response_model=CustomerRecord,
    )
    def customer(customer_id: UUID):
        with engine().connect() as conn:
            if not crm:
                check_availability(conn)
            return read_projection(conn, table, customer_id)

    @app.get("/v1/customers", dependencies=secured, response_model=list[CustomerRecord])
    def list_customers():
        with engine().connect() as conn:
            if not crm:
                check_availability(conn)
            return [
                dict(row)
                for row in run(
                    conn, f"SELECT * FROM {table} ORDER BY name,id LIMIT 100"
                ).mappings()
            ]

    if crm:

        @app.post(
            "/v1/customers",
            dependencies=secured,
            status_code=201,
            response_model=Publication,
        )
        def create(payload: Profile, correlation: Correlation = None):
            with engine().begin() as conn:
                return save_profile(conn, payload, correlation or uuid4())

        @app.put(
            "/v1/customers/{customer_id}",
            dependencies=secured,
            response_model=Publication,
        )
        def update(
            customer_id: UUID, payload: Profile, correlation: Correlation = None
        ):
            with engine().begin() as conn:
                return save_profile(conn, payload, correlation or uuid4(), customer_id)

        @app.post(
            "/v1/customers/{customer_id}/republish",
            dependencies=secured,
            status_code=202,
            response_model=Publication,
        )
        def republish(customer_id: UUID, correlation: Correlation = None):
            with engine().begin() as conn:
                return republish_profile(conn, customer_id, correlation or uuid4())

        @app.put(
            "/v1/customers/{customer_id}/payment-projection",
            dependencies=secured,
            response_model=ProjectionResult,
        )
        def payment(customer_id: UUID, payload: PaymentProjection):
            with engine().begin() as conn:
                return {"outcome": sync_payment(conn, customer_id, payload)}
    else:
        install_fault_control(app)

        @app.put(
            "/v1/customers/{customer_id}",
            dependencies=secured,
            response_model=ProjectionResult,
        )
        def billing_projection(customer_id: UUID, payload: ProfileProjection):
            with engine().begin() as conn:
                check_availability(conn)
                return {
                    "outcome": sync_profile(
                        conn,
                        "contracts",
                        customer_id,
                        payload.version,
                        payload.name,
                        payload.email,
                    )
                }

        @app.post(
            "/v1/customers/{customer_id}/payments",
            dependencies=secured,
            status_code=201,
            response_model=Publication,
        )
        def payment(
            customer_id: UUID, payload: Payment, correlation: Correlation = None
        ):
            with engine().begin() as conn:
                check_availability(conn)
                return register_payment(
                    conn, customer_id, payload, correlation or uuid4()
                )

    return app


crm = create_source("crm")
billing = create_source("billing")
