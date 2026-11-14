from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
Email = Annotated[
    str, StringConstraints(max_length=160, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
]
Version = Annotated[int, Field(strict=True, ge=1, le=2147483647)]
PaymentStatus = Literal["UNPAID", "PAID"]


class Profile(Strict):
    name: Name
    email: Email | None = None


class ProfileProjection(Profile):
    version: Version


class Payment(Strict):
    status: PaymentStatus


class PaymentProjection(Payment):
    version: Version


class Envelope(Strict):
    id: UUID
    correlation_id: UUID
    customer_id: UUID
    schema_version: Literal[1]
    version: Version
    occurred_at: AwareDatetime


class ProfileEvent(Envelope):
    source: Literal["CRM"]
    type: Literal["customer.profile"]
    data: Profile


class PaymentEvent(Envelope):
    source: Literal["Billing"]
    type: Literal["customer.payment"]
    data: Payment


Event = Annotated[ProfileEvent | PaymentEvent, Field(discriminator="type")]
ROUTES = {"customer.profile": ("ERP", "Billing"), "customer.payment": ("CRM",)}


def make_event(
    customer_id: UUID, version: int, data: Profile | Payment, correlation: UUID
):
    base = dict(
        id=uuid4(),
        correlation_id=correlation,
        customer_id=customer_id,
        schema_version=1,
        version=version,
        occurred_at=datetime.now(UTC),
    )
    if isinstance(data, Profile):
        return ProfileEvent(**base, source="CRM", type="customer.profile", data=data)
    return PaymentEvent(**base, source="Billing", type="customer.payment", data=data)
