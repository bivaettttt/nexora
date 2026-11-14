from uuid import uuid4

from nexora.domain import Profile, make_event
from nexora.worker import parse_message


def test_event_ingestion_contract():
    event = make_event(uuid4(), 1, Profile(name="Fixture"), uuid4())
    assert parse_message(event.model_dump_json().encode())[0] == event.id
    raw = event.model_copy(update={"schema_version": 2}).model_dump_json()
    assert parse_message(raw.encode())[-1] == "INVALID_CONTRACT"


def test_routes_and_mapping_preserve_field_ownership():
    from nexora.adapters import mapping
    from nexora.domain import ROUTES, Payment

    customer, correlation = uuid4(), uuid4()
    profile = make_event(
        customer, 2, Profile(name="Synthetic", email="crm@example.test"), correlation
    ).model_dump(mode="json")
    payment = make_event(customer, 1, Payment(status="PAID"), correlation).model_dump(
        mode="json"
    )
    assert ROUTES[profile["type"]] == ("ERP", "Billing")
    assert ROUTES[payment["type"]] == ("CRM",)
    assert mapping(profile, "ERP") == {
        "GlobalId": str(customer),
        "Version": 2,
        "LegalName": "Synthetic",
    }
    assert mapping(profile, "Billing") == {
        "name": "Synthetic",
        "email": "crm@example.test",
        "version": 2,
    }
    assert mapping(payment, "CRM") == {"status": "PAID", "version": 1}


def test_projection_version_rules():
    import pytest
    from fastapi import HTTPException

    from nexora.projections import compare_projection

    record = {"version": 2, "name": "current"}
    assert compare_projection(record, 1, {"name": "old"}) == "STALE"
    assert compare_projection(record, 2, {"name": "current"}) == "SAME"
    assert compare_projection(record, 3, {"name": "new"}) == "APPLIED"
    with pytest.raises(HTTPException, match="VERSION_CONFLICT"):
        compare_projection(record, 2, {"name": "different"})
