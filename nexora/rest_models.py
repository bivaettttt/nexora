from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from nexora.domain import PaymentStatus


class CustomerRecord(BaseModel):
    id: UUID
    local_id: UUID
    version: int
    name: str
    email: str | None
    payment_status: PaymentStatus | None
    payment_version: int


class Publication(BaseModel):
    record: CustomerRecord
    event_id: UUID
    correlation_id: UUID


class ProjectionResult(BaseModel):
    outcome: Literal["APPLIED", "SAME", "STALE"]


class ServiceRecord(BaseModel):
    id: UUID
    local_id: UUID
    name: str
    version: int
    email: str | None = None
    payment_status: PaymentStatus | None = None
    payment_version: int | None = None


class Difference(BaseModel):
    target: Literal["ERP", "CRM", "Billing"]
    code: Literal[
        "UNREACHABLE",
        "MISSING",
        "IDENTIFIER_MISMATCH",
        "VERSION_LAG",
        "AHEAD",
        "FIELD_DRIFT",
        "PAYMENT_DRIFT",
        "CONTRACT",
    ]
    field: str | None = None


class Reconciliation(BaseModel):
    customer_id: UUID
    records: dict[str, ServiceRecord | None]
    issues: list[Difference]
