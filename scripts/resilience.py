from uuid import uuid4

import httpx
from integration_smoke import api, call, completed, detail, profile, wait_until


def availability(target, unavailable):
    call("PUT", f"/lab/availability/{target}", json={"unavailable": unavailable})


def outages_and_replay():
    availability("ERP", True)
    try:
        created = profile("ERP recovery")
        event = created["event_id"]
        customer = created["record"]["id"]
        outcome = completed(event, {"ERP": "DEAD", "Billing": "SUCCEEDED"})
        failed = next(d for d in outcome["deliveries"] if d["target"] == "ERP")
        assert [a["outcome"] for a in failed["attempts"]] == ["UNAVAILABLE"] * 4
        assert any(
            row["delivery_id"] == failed["id"]
            for row in call("GET", "/errors?dead_only=true")
        )
        assert {"target": "ERP", "code": "UNREACHABLE", "field": None} in call(
            "GET", f"/reconciliation/{customer}"
        )["issues"]
    finally:
        availability("ERP", False)
    assert {"target": "ERP", "code": "MISSING", "field": None} in call(
        "GET", f"/reconciliation/{customer}"
    )["issues"]
    call("POST", "/deliveries/" + failed["id"] + "/replay", 202)
    recovered = completed(event, {"ERP": "SUCCEEDED", "Billing": "SUCCEEDED"})
    erp = next(d for d in recovered["deliveries"] if d["target"] == "ERP")
    assert [a["generation"] for a in erp["attempts"]] == [0, 0, 0, 0, 1]
    assert call("GET", f"/reconciliation/{customer}")["issues"] == []

    availability("Billing", True)
    try:
        created = profile("Billing recovery")
        completed(created["event_id"], {"Billing": "RETRY", "ERP": "SUCCEEDED"})
    finally:
        availability("Billing", False)
    completed(created["event_id"], {"Billing": "SUCCEEDED", "ERP": "SUCCEEDED"})


def quarantine_dedupe_stale(updated):
    event = updated["event_id"]
    customer = updated["record"]["id"]
    initial = detail(event)
    call("POST", "/lab/publish/duplicate", 202, json={"event_id": event})
    stale = call("POST", "/lab/publish/stale", 202, json={"event_id": event})
    stale_detail = completed(
        stale["event_id"], {"ERP": "SUCCEEDED", "Billing": "SUCCEEDED"}
    )
    assert {d["outcome"] for d in stale_detail["deliveries"]} == {"STALE"}
    assert detail(event)["deliveries"] == initial["deliveries"]
    assert call("GET", f"/reconciliation/{customer}")["records"]["ERP"]["version"] == 2
    prior = {row["event_id"] for row in call("GET", "/errors?dead_only=true")}
    call("POST", "/lab/publish/invalid", 202, json={})
    wait_until(
        lambda: call("GET", "/errors?dead_only=true"),
        lambda data: any(
            row["event_id"] not in prior and row["code"] == "INVALID_CONTRACT"
            for row in data
        ),
    )


def repair_projection():
    availability("ERP", True)
    try:
        created = profile("Reconciliation recovery")
        completed(created["event_id"], {"ERP": "DEAD", "Billing": "SUCCEEDED"})
    finally:
        availability("ERP", False)
    customer = created["record"]["id"]
    assert {"target": "ERP", "code": "MISSING", "field": None} in call(
        "GET", f"/reconciliation/{customer}"
    )["issues"]
    repair = call("POST", f"/reconciliation/{customer}/repair", 202)
    completed(repair["event_id"], {"ERP": "SUCCEEDED", "Billing": "SUCCEEDED"})
    assert call("GET", f"/reconciliation/{customer}")["issues"] == []


def security_checks():
    assert httpx.get(api.base_url.join("/api/stats")).status_code == 401
    viewer = {"Authorization": "Bearer nexora-local-viewer"}
    assert (
        api.post(
            "/api/customers", json={"name": "Unauthorized"}, headers=viewer
        ).status_code
        == 403
    )
    assert (
        api.post("/api/lab/publish/invalid", json={}, headers=viewer).status_code == 403
    )
    assert api.get("/api/messages/" + str(uuid4())).status_code == 404
    assert api.put(
        "/api/lab/availability/http:%2F%2Fexternal", json={"unavailable": True}
    ).status_code in (404, 422)


if __name__ == "__main__":
    from integration_smoke import test_route

    security_checks()
    quarantine_dedupe_stale(test_route())
    outages_and_replay()
    repair_projection()
    print(
        "Verified: ERP and Billing outages, partial success, retry exhaustion, DLQ, replay generations, duplicate, stale, quarantine, reconciliation and role gates"
    )
