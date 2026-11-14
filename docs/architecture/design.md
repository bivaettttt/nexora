# Architecture / Архитектура

Each participant is a separate HTTP process with a separate PostgreSQL database and login. Nexora API and Worker share the Nexora database. CRM and Billing publish their own transactional Outboxes to RabbitMQ. ERP accepts document/literal SOAP 1.1. A registry compiled from code defines destinations and mappings.

Каждый участник работает отдельным процессом и использует собственные БД и учётную запись. CRM и Billing публикуют транзакционный Outbox. API и Worker Nexora используют общую БД. ERP принимает SOAP 1.1 document/literal. Маршруты и адреса задаются окружением и кодом, данные события не управляют URL.

| Source | v1 event | Target | Mapping |
|---|---|---|---|
| CRM | customer.profile | ERP SOAP UpsertPartner | customer_id → GlobalId, version → Version, name → LegalName |
| CRM | customer.profile | Billing REST PUT customer | customer_id, version, name, email |
| Billing | customer.payment | CRM REST PUT payment | customer_id, version, status |

Envelope: id, correlation_id, source, type, schema_version, customer_id, version, occurred_at, data. UUIDs identify events, transactions and customers. A producer increments an attribute-specific version inside its write transaction. Email is optional and absence clears the contact. Recipients keep stable local IDs and atomically check version before writing. Equal versions with unequal payloads are permanent conflicts.

## Failure handling

| Class | Signal | Strategy |
|---|---|---|
| Validation | Invalid envelope, type or payload | Persist rejected event in PostgreSQL quarantine and ack |
| Contract | Malformed successful response | Dead-letter delivery |
| Authorization | 401/403 | Dead-letter delivery |
| Permanent business rejection | Other 4xx or SOAP Client fault | Dead-letter delivery |
| Timeout / network / unavailable | Transport failure, 429, 5xx or SOAP Server fault | Retry up to four calls with exponential delay and jitter |
| Internal failure | Unexpected exception or DB outage | Roll back, preserve due work, reconnect |

## ADR-01 · Transactional exchange

Outbox rows are committed with source writes. Publisher confirms precede marking sent. The crash window before marking sent may duplicate publication. Inbox stores one event ID and payload hash, schedules independent delivery rows, and acks after commit. Redelivery after commit is safe. Delivery workers hold a PostgreSQL row lock over a bounded target call and record the result and attempt together. A crash after the target commits can repeat the call. Target projections enforce monotonic versions and an equal-version content check. PostgreSQL quarantine stores poison events and terminal delivery records for inspection and controlled recovery. RabbitMQ is the durable transport, PostgreSQL is the operator's recovery ledger.

## ADR-02 · Controlled reconciliation and sandbox

Read actual projections through REST and SOAP. Repair republishes the current CRM snapshot using a fresh event ID. Targets apply ordinary version rules. Schedule Lab runs in a dedicated Compose deployment using distinct databases and broker state. Faults simulate temporary availability responses, with no runtime access to the Docker socket.

[RabbitMQ confirms and acknowledgements](https://www.rabbitmq.com/docs/confirms) · [SOAP 1.1](https://www.w3.org/TR/2000/NOTE-SOAP-20000508/)

## Diagrams / Диаграммы

[C4 Context](../diagrams/context.mmd) · [C4 Container](../diagrams/container.mmd) · [Data flow](../diagrams/components.mmd) · [Synchronous sequence](../diagrams/sync.mmd) · [Asynchronous sequence](../diagrams/async.mmd) · [Delivery state machine](../diagrams/lifecycle.mmd) · [BPMN 2.0 ingress](../diagrams/ingress.bpmn) · [ERD](../diagrams/erd.mmd)
