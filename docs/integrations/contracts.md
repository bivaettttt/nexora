# Контракты и преобразования / Contracts and mapping

[CRM REST](../api/crm.openapi.json) · [Billing REST](../api/billing.openapi.json) · [Nexora REST](../api/nexora.openapi.json) · [ERP WSDL](../../nexora/contracts/partner.wsdl) · [ERP XSD](../../nexora/contracts/partner.xsd) · [RabbitMQ AsyncAPI](asyncapi.yaml)

- **CRM → ERP.** `customer_id` → `GlobalId`, `version` → `Version`, `data.name` → `LegalName`. SOAPAction `urn:nexora:partner:v1:UpsertPartner`. Статусы `APPLIED`, `SAME`, `STALE`.
- **CRM → Billing.** UUID в URL, `data.name` → `name`, `data.email` → `email`, `version` → `version`. `null` очищает email.
- **Billing → CRM.** UUID в URL, `data.status` → `status`, `version` → `version`. Операция меняет только платёжную проекцию.

Full source snapshots allow newer versions to apply even if an intermediate version is delayed. A new incompatible event shape requires a new schema version and explicit route support. The v1 consumer quarantines unsupported shapes. SOAP faults use SOAP 1.1 Client or Server codes. REST validation uses 422, authentication 401, role denial 403, missing entities 404 and version conflicts 409.

Create a customer on the local console API:

```sh
curl -fsS http://127.0.0.1:8090/api/customers \
  -H 'Authorization: Bearer nexora-local-operator' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Синтетический клиент","email":"demo@example.test"}'
```

The HTTP 201 body contains `record`, `event_id`, and `correlation_id`. Inspect asynchronous delivery using `GET /api/messages/{event_id}`. A successful publish does not imply target application.

SOAP UpsertPartner body:

```xml
<p:UpsertPartner xmlns:p="urn:nexora:partner:v1">
  <p:GlobalId>50c096b7-6ed7-4443-8ec7-b82696a4cc86</p:GlobalId>
  <p:Version>1</p:Version>
  <p:LegalName>Synthetic partner</p:LegalName>
</p:UpsertPartner>
```

The endpoint accepts a SOAP 1.1 Envelope containing this element as the only Body child. The reply wraps `UpsertPartnerResponse` with `Outcome`. GetPartner returns the global ID, ERP local ID, version and legal name.

## Trust boundaries / Границы доверия

Service requests require a server-side bearer key. Console bearer keys map to viewer, operator and admin. The browser keeps a key only in memory. HTTPS and individual identities are deployment extensions. Typed UUIDs and a fixed-address registry constrain requests, with HTTP redirects disabled. XML is bounded, parser network access and entity expansion are disabled, and DTDs are rejected. Invalid broker payloads retain metadata and digest. The local stack publishes only the web listener. Operators can read synthetic event data and service endpoints.
