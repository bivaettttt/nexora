from pathlib import Path
from uuid import uuid4

import jsonschema
import pytest
import yaml
from lxml import etree
from pydantic import ValidationError

from nexora.domain import Payment, Profile, make_event
from nexora.soap import CONTRACTS, NS, SOAP, decode, encode


@pytest.mark.parametrize(
    "data,name",
    [(Profile(name="Synthetic"), "Profile"), (Payment(status="PAID"), "Payment")],
)
def test_asyncapi_matches_emitted_event(data, name):
    event = make_event(uuid4(), 1, data, uuid4()).model_dump(mode="json")
    doc = yaml.safe_load(Path("docs/integrations/asyncapi.yaml").read_text())
    schema = doc["components"]["messages"][name]["payload"]
    schema["allOf"][0] = doc["components"]["schemas"]["Envelope"]
    jsonschema.Draft7Validator(
        schema, format_checker=jsonschema.Draft7Validator.FORMAT_CHECKER
    ).validate(event)
    event["schema_version"] = 2


def test_soap_contract():
    fields = {"GlobalId": str(uuid4()), "Version": 2, "LegalName": "A & B"}
    operation, wire = decode(encode("UpsertPartner", fields))
    assert operation == "UpsertPartner"
    assert wire == {**fields, "Version": "2"}
    wsdl = etree.parse(str(CONTRACTS / "partner.wsdl"))
    assert wsdl.xpath("//*[local-name()='operation' and @name='UpsertPartner']")
    assert wsdl.xpath("//*[local-name()='import']/@schemaLocation") == ["partner.xsd"]
    with pytest.raises(etree.DocumentInvalid):
        encode("UpsertPartner", {**fields, "Version": 0})


def test_dtd_is_rejected():
    raw = f'<!DOCTYPE Envelope><s:Envelope xmlns:s="{SOAP}" xmlns:p="{NS}"><s:Body><p:GetPartner/></s:Body></s:Envelope>'
    with pytest.raises(ValueError, match="DTD_FORBIDDEN"):
        decode(raw.encode())


def test_input_validation():
    with pytest.raises(ValidationError):
        Profile(name="   ", email="invalid")
