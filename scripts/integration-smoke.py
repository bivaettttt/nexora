import os
from time import monotonic, sleep

import httpx

api = httpx.Client(
    base_url=os.getenv("NEXORA_API_URL", "http://api:8000"),
    timeout=5,
    headers={
        "Authorization": "Bearer " + os.getenv("NEXORA_ADMIN_KEY", "nexora-local-admin")
    },
)


def call(method, path, expected=200, **kwargs):
    response = api.request(method, "/api" + path, **kwargs)
    assert response.status_code == expected, (path, response.status_code, response.text)
    return response.json()


def wait_until(fetch, predicate, timeout=25):
    deadline = monotonic() + timeout
    while monotonic() < deadline:
        value = fetch()
        if predicate(value):
            return value
        sleep(0.2)
    raise AssertionError(f"Timeout, latest result: {value}")


def detail(event):
    response = api.get("/api/messages/" + event)
    return None if response.status_code == 404 else response.json()


def completed(event, targets):
    return wait_until(
        lambda: detail(event),
        lambda data: (
            data and {d["target"]: d["status"] for d in data["deliveries"]} == targets
        ),
    )


def profile(name):
    return call(
        "POST", "/customers", 201, json={"name": name, "email": "bot@example.test"}
    )


def test_route():
    created = profile("Северный Контур")
    customer = created["record"]["id"]
    event = created["event_id"]
    delivered = completed(event, {"ERP": "SUCCEEDED", "Billing": "SUCCEEDED"})
    assert delivered["event"]["correlation_id"] == created["correlation_id"]
    assert all(
        d["attempts"][0]["outcome"] == "APPLIED" for d in delivered["deliveries"]
    )
    updated = call(
        "PUT",
        f"/customers/{customer}",
        json={"name": "Северный Контур · 2", "email": None},
    )
    completed(updated["event_id"], {"ERP": "SUCCEEDED", "Billing": "SUCCEEDED"})
    paid = call("POST", f"/customers/{customer}/payment", 201, json={"status": "PAID"})
    completed(paid["event_id"], {"CRM": "SUCCEEDED"})
    compare = call("GET", f"/reconciliation/{customer}")
    assert compare["issues"] == [], compare
    assert compare["records"]["CRM"]["payment_status"] == "PAID"
    assert compare["records"]["ERP"]["version"] == 2
    assert compare["records"]["Billing"]["email"] is None
    return updated


if __name__ == "__main__":
    test_route()
    print(
        "CRM → Outbox → RabbitMQ → Inbox → ERP SOAP + Billing REST; update, payment and reconciliation verified"
    )
