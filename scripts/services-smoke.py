import os
from uuid import uuid4

import httpx

from nexora.adapters import read_remote, request, soap_request
from nexora.soap import decode

assert os.environ["SERVICE_KEY"]
identifier = uuid4()
reply = request(
    "CRM",
    "POST",
    "/v1/customers",
    json={"name": "Synthetic transport check", "email": "test@example.test"},
)
assert reply.status_code == 201, reply.status_code
customer = reply.json()["record"]["id"]
assert read_remote("CRM", customer)["name"] == "Synthetic transport check"
reply = soap_request(
    "UpsertPartner",
    {"GlobalId": str(identifier), "Version": 1, "LegalName": "SOAP transport"},
)
assert reply.status_code == 200, reply.status_code
assert decode(reply.content)[1] == {"Outcome": "APPLIED"}
assert read_remote("ERP", str(identifier))["name"] == "SOAP transport"
reply = request(
    "Billing",
    "PUT",
    f"/v1/customers/{identifier}",
    json={"name": "REST transport", "version": 1},
)
assert reply.status_code == 200, reply.status_code
assert read_remote("Billing", str(identifier))["name"] == "REST transport"
assert httpx.get("http://crm:8000/v1/customers").status_code == 401
assert httpx.get("http://erp:8000/partner.wsdl").status_code == 200
print("CRM REST, ERP SOAP, Billing REST and service authorization verified")
