# Nexora · Enterprise Integration Platform

[Русский](README.ru.md)

Nexora is an educational case study in data exchange across independent applications. CRM owns customer profile fields, ERP holds partner records, and Billing owns contract and payment state. Operators can inspect what was delivered, diagnose failures, and replay individual deliveries.

## Run

```sh
docker compose up --build
```

Open the [console](http://127.0.0.1:8090). Local keys are `nexora-local-viewer`, `nexora-local-operator`, and `nexora-local-admin`. Startup runs migrations, seeds three synthetic CRM profiles, and lets normal delivery populate the target applications. See [.env.example](.env.example) for port and console credentials. The web listener binds to loopback.

Run experiments in a separate Compose project:

```sh
scripts/lab up
```

The lab is available to admins on [8091](http://127.0.0.1:8091). It has separate containers, networks and volumes. Run `scripts/lab down` to stop it or `scripts/lab reset` to delete its data. Run `docker compose down -v` to delete data from the main local stack.

## Exchange and recovery

1. CRM commits a profile and transactional Outbox together. Its relay publishes to RabbitMQ and marks the record sent after publisher confirmation.
2. The Worker validates the v1 contract, records the Inbox and creates target delivery rows. It acknowledges RabbitMQ after commit.
3. The Worker maps a profile to ERP SOAP XML and Billing REST JSON. Target delivery loops run independently.
4. Targets check versions atomically. Equal versions with the same fields produce `SAME`, and older versions produce `STALE`. Billing sends payment updates to CRM only.
5. Transient failures trigger up to four attempts with exponential backoff and jitter. A PostgreSQL quarantine holds invalid events and exhausted deliveries. A manual replay preserves prior attempts.
6. Reconciliation reads actual REST and SOAP projections. Repair republishes the current CRM profile for missing or lagging records, subject to the same version rules.

The applications use distinct PostgreSQL databases and roles. Nexora API and Worker share their integration database. The stack uses Python, FastAPI, Pydantic, SQLAlchemy, Alembic, RabbitMQ, React, TypeScript, Vite and nginx. Python source lives in `nexora/`, migrations in `migrations/`, the console and browser tests in `frontend/`, and analysis and contracts in `docs/`.

[Requirements](docs/analysis/mvp.md) · [Architecture and diagrams](docs/architecture/design.md) · [REST, WSDL/XSD and AsyncAPI](docs/integrations/contracts.md) · [Traceability](docs/testing/traceability.md)

## Demonstrate

Create a customer in **Клиенты CRM**, open its event and compare the ERP and Billing transformations. Record a payment and inspect the CRM delivery. In the lab, disable ERP responses, create a customer and wait for four ERP attempts. Billing completes independently. Restore ERP, open the delivery from the DLQ, and confirm replay. Inspect both attempt generations under the same Delivery ID and run reconciliation. If the payment response is lost, inspect the customer’s payment events and reconciliation before taking further action.

[Redesign notes](docs/ux-ui-redesign.md) · [Acceptance matrix](docs/testing/ux-acceptance.md)

[Workbench](assets/screenshots/workbench.png) · [Message Explorer](assets/screenshots/messages.png) · [Successful delivery](assets/screenshots/successful-delivery.png) · [Partial delivery](assets/screenshots/partial-delivery.png) · [Timeline](assets/screenshots/timeline.png) · [Retry](assets/screenshots/retry-details.png) · [DLQ](assets/screenshots/dlq.png) · [Recovery](assets/screenshots/recovery.png) · [Transport and business state](assets/screenshots/stale-result.png) · [Error inspector](assets/screenshots/error-inspector.png) · [Architecture](assets/screenshots/routes.png) · [SOAP and payload](assets/screenshots/payload-inspector.png) · [Dashboard](assets/screenshots/dashboard.png) · [Mobile trace](assets/screenshots/mobile-trace.png) · [Uncertain payment](assets/screenshots/uncertain-payment.png) · [Lab](assets/screenshots/lab.png) · [Reconciliation](assets/screenshots/reconciliation.png)

## Quality and limits

The [test report](docs/testing/results.md) records pytest, real-service integration and recovery checks, and Playwright. CI uses the [Quality workflow](.github/workflows/quality.yml). [Project status](docs/PROJECT_STATUS.md)

The exchange provides at-least-once delivery with persistent deduplication and version guards. RabbitMQ carries traffic and PostgreSQL implements the operator DLQ. Invalid payloads are reduced to diagnostic metadata. The local stack uses shared role keys and synthetic data. A network deployment would require individual identities, TLS and a retention policy. Future extensions include batch reconciliation, distinct service credentials, retention controls, and load testing.
