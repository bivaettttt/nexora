# Test strategy and observed results / Стратегия и результаты

| ID | Check | Observed outcome |
|---|---|---|
| TC-01 | Source services and full exchange | CRM profile created, then updated in PostgreSQL-backed ERP SOAP and Billing REST. Payment returned to CRM only |
| TC-02 | ERP outage, partial delivery, Billing recovery | Four ERP attempts and independent Billing success. Manual replay created a new generation and preserved four previous attempts. Billing recovered via automatic retry |
| TC-03 | Duplicate, stale and invalid event | Matching duplicate preserved two existing deliveries, stale events yielded STALE on both targets, invalid contract appeared in quarantine |
| TC-04 | RabbitMQ downtime, Worker restart and Outbox republish | CRM committed an unsent Outbox row during downtime. Both target deliveries completed after restart. The same outbox message was confirmed again and delivery attempts remained single |
| TC-05 | Reconciliation and repair | Missing ERP record detected after service recovery. CRM republish restored it and cleared discrepancies |
| TC-06 | Contract and access | Eight pytest cases passed. Live SOAP/REST checks passed. Viewer write, lab access without admin, and arbitrary target values were rejected. BPMN validated against OMG BPMN 2.0 XML Schema |
| TC-07 | Real browser | Three Chromium tests passed for creation and reconciliation, real quarantine, and mobile viewer navigation |

The strategy combines pure validation and mapping assertions, contract fixtures, live endpoint comparisons, fault and recovery scripts, and browser assertions. Integration tests operate on a separate Compose project with synthetic data, real RabbitMQ and dedicated PostgreSQL databases. The restart test resets a sent marker to reproduce the relay crash window, then verifies republication. Shared role keys, per-customer snapshots and retention are bounded by the educational scope.

## Run

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pytest -q
ruff check nexora migrations scripts tests
ruff format --check nexora migrations scripts tests
PYTHONPATH=. python scripts/openapi.py --check
python scripts/check-repository.py
scripts/lab up
docker compose -p nexora-lab exec -T crm python - < scripts/services-smoke.py
scripts/run-integration
scripts/restart-check
cd frontend
npm ci
npm run format:check
npm run build
npx playwright install chromium
npm run test:e2e
```

[GitHub Actions status](https://github.com/bivaettttt/nexora/actions)

The AsyncAPI CLI validated the AMQP document. It reported advisory metadata warnings for the contact and license fields. Payload examples are also checked against the runtime event models in pytest.
