# Traceability / Трассируемость

| Need | Requirement | Contract and component | Implementation | Check |
|---|---|---|---|---|
| Propagate a customer profile | FR-01, BR-01/06 | REST, SOAP and AMQP | [Source](../../nexora/source.py), [adapters](../../nexora/adapters.py) | TC-01 create and update |
| Propagate billing status | FR-02, BR-02 | Billing → CRM REST | [Projections](../../nexora/projections.py) | TC-01 payment |
| Follow message and attempts | FR-03/09 | Nexora REST, PostgreSQL | [Operations](../../nexora/operations.py) | TC-01 correlation, TC-07 UI |
| Isolate a target failure | FR-04, NFR-01/02 | AMQP, per-target delivery | [Worker](../../nexora/worker.py) | TC-02 ERP and Billing |
| Diagnose and recover failure | FR-05 | Nexora replay API | [Operations](../../nexora/operations.py) | TC-02 DLQ, TC-03 invalid contract |
| Maintain freshness | FR-06, BR-03/05 | Event ID and version | [Worker](../../nexora/worker.py), [projections](../../nexora/projections.py) | TC-03 duplicate/stale, TC-04 restart |
| Reconcile records | FR-07, BR-04 | REST reads and SOAP GetPartner | [Operations](../../nexora/operations.py) | TC-05 missing and repair |
| Run controlled failures | FR-08, NFR-03/04 | Lab REST and separate Compose project | [Lab launcher](../../scripts/lab), [API](../../nexora/api.py) | TC-02/03/06/07 |

[Contracts](../integrations/contracts.md) · [Test strategy and observed results](results.md)
