import os
from dataclasses import dataclass

import httpx
from lxml import etree

from nexora.soap import NS, decode, encode

ADDRESSES = {
    "CRM": "http://crm:8000",
    "ERP": "http://erp:8000",
    "Billing": "http://billing:8000",
}


@dataclass(frozen=True)
class DeliveryResult:
    code: str
    status: int | None = None
    retry: bool = False


def request(target, method, path, *, correlation=None, **kwargs):
    headers = {
        "Authorization": "Bearer " + os.environ["SERVICE_KEY"],
        **kwargs.pop("headers", {}),
    }
    if correlation:
        headers["X-Correlation-ID"] = str(correlation)
    with httpx.Client(
        timeout=httpx.Timeout(2.5), follow_redirects=False, trust_env=False
    ) as client:
        return client.request(
            method, ADDRESSES[target] + path, headers=headers, **kwargs
        )


def soap_request(operation, fields, correlation=None):
    return request(
        "ERP",
        "POST",
        "/soap",
        content=encode(operation, fields),
        correlation=correlation,
        headers={
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": f'"{NS}:{operation}"',
        },
    )


def mapping(event, target):
    data = event["data"]
    if target == "ERP":
        return {
            "GlobalId": str(event["customer_id"]),
            "Version": event["version"],
            "LegalName": data["name"],
        }
    return {**data, "version": event["version"]}


def deliver(event, target):
    fields = mapping(event, target)
    correlation = event["correlation_id"]
    try:
        if target == "ERP":
            response = soap_request("UpsertPartner", fields, correlation)
        else:
            path = f"/v1/customers/{event['customer_id']}"
            if target == "CRM":
                path += "/payment-projection"
            response = request(
                target, "PUT", path, json=fields, correlation=correlation
            )
    except httpx.TimeoutException:
        return DeliveryResult("TIMEOUT", retry=True)
    except httpx.TransportError:
        return DeliveryResult("NETWORK", retry=True)
    except (ValueError, etree.LxmlError):
        return DeliveryResult("CONTRACT")

    status = response.status_code
    if status in (401, 403):
        return DeliveryResult("AUTHORIZATION", status)
    if status in (429, 502, 503, 504):
        return DeliveryResult("UNAVAILABLE", status, True)
    try:
        if target == "ERP" and status in (200, 500):
            operation, payload = decode(response.content, accept_fault=True)
            if status == 500 and operation == "Fault":
                client_fault = payload.get("faultcode", "").endswith(":Client")
                code = payload.get("faultstring")
                if client_fault:
                    return DeliveryResult(
                        "CONTRACT"
                        if code == "INVALID_CONTRACT"
                        else "BUSINESS_REJECTION",
                        status,
                    )
                return DeliveryResult("UNAVAILABLE", status, True)
            outcome = (
                payload.get("Outcome") if operation == "UpsertPartnerResponse" else None
            )
        elif status == 200:
            outcome = response.json().get("outcome")
        else:
            outcome = None
    except (ValueError, AttributeError, etree.LxmlError):
        return DeliveryResult("CONTRACT", status)
    if status >= 500:
        return DeliveryResult("UNAVAILABLE", status, True)
    if status != 200:
        return DeliveryResult(
            "BUSINESS_REJECTION" if 400 <= status < 500 else "CONTRACT", status
        )
    return DeliveryResult(
        outcome if outcome in ("APPLIED", "SAME", "STALE") else "CONTRACT", status
    )


def read_remote(target, customer_id):
    if target == "ERP":
        response = soap_request("GetPartner", {"GlobalId": customer_id})
        operation, values = decode(response.content, accept_fault=True)
        if operation == "Fault" and values.get("faultstring") == "RECORD_MISSING":
            return None
        response.raise_for_status()
        if operation != "GetPartnerResponse":
            raise ValueError("Unexpected SOAP response")
        return {
            "id": values["GlobalId"],
            "local_id": values["LocalId"],
            "version": int(values["Version"]),
            "name": values["LegalName"],
        }
    response = request(target, "GET", f"/v1/customers/{customer_id}")
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()
