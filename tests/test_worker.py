from uuid import uuid4

from nexora.domain import Profile, make_event
from nexora.worker import parse_message


def test_event_ingestion_contract():
    event = make_event(uuid4(), 1, Profile(name="Fixture"), uuid4())
    assert parse_message(event.model_dump_json().encode())[0] == event.id
    raw = event.model_copy(update={"schema_version": 2}).model_dump_json()
    assert parse_message(raw.encode())[-1] == "INVALID_CONTRACT"
