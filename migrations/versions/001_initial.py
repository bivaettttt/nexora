import os

from alembic import op

revision = "001"
down_revision = None

OUTBOX = """
CREATE TABLE outbox (
  id uuid PRIMARY KEY, payload jsonb NOT NULL, created_at timestamptz DEFAULT now() NOT NULL,
  sent_at timestamptz
);
CREATE INDEX pending_outbox ON outbox(created_at) WHERE sent_at IS NULL;
"""
CRM = """
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL, email text, version int NOT NULL CHECK(version > 0),
  payment_status text CHECK(payment_status IN ('UNPAID','PAID')),
  payment_version int NOT NULL DEFAULT 0 CHECK(payment_version >= 0)
);
"""
BILLING = """
CREATE TABLE contracts (
  id uuid PRIMARY KEY,
  local_id uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL, email text, version int NOT NULL CHECK(version > 0),
  payment_status text NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN ('UNPAID','PAID')),
  payment_version int NOT NULL DEFAULT 0 CHECK(payment_version >= 0)
);
"""
ERP = """
CREATE TABLE partners (
  id uuid PRIMARY KEY,
  local_id uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL, version int NOT NULL CHECK(version > 0)
);
"""
CORE = """
CREATE TABLE events (
  id uuid PRIMARY KEY, correlation_id uuid, customer_id uuid, source text, type text,
  version int, payload jsonb NOT NULL, digest text NOT NULL,
  rejection text, received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX events_correlation ON events(correlation_id);
CREATE INDEX events_recent ON events(received_at DESC);
CREATE TABLE deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events,
  target text NOT NULL CHECK (target IN ('CRM','ERP','Billing')),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RETRY','SUCCEEDED','DEAD')),
  generation int NOT NULL DEFAULT 0, calls int NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  outcome text,
  UNIQUE(event_id, target)
);
CREATE INDEX due_deliveries ON deliveries(target,next_at) WHERE status IN ('PENDING','RETRY');
CREATE TABLE attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES deliveries,
  generation int NOT NULL, number int NOT NULL, started_at timestamptz NOT NULL,
  duration_ms int NOT NULL CHECK(duration_ms >= 0), http_status int, outcome text NOT NULL,
  UNIQUE(delivery_id,generation,number)
);
CREATE TABLE actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role text NOT NULL, action text NOT NULL, object_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
"""
FAULTS = """
CREATE TABLE controls (id integer PRIMARY KEY CHECK(id=1), unavailable boolean NOT NULL);
INSERT INTO controls VALUES(1,false);
"""
DDL = {
    "crm": CRM + OUTBOX,
    "billing": BILLING + OUTBOX + FAULTS,
    "erp": ERP + FAULTS,
    "core": CORE,
}
TABLES = {
    "crm": ["outbox", "customers"],
    "billing": ["controls", "outbox", "contracts"],
    "erp": ["controls", "partners"],
    "core": ["actions", "attempts", "deliveries", "events"],
}


def upgrade():
    op.execute(DDL[os.environ["DB_COMPONENT"]])


def downgrade():
    for table in TABLES[os.environ["DB_COMPONENT"]]:
        op.drop_table(table)
