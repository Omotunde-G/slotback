BEGIN;

CREATE TABLE business_owners (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buffer_account_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE slots (
  id UUID PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES business_owners(id),

  business_name VARCHAR(120) NOT NULL,
  service_name VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  location VARCHAR(250) NOT NULL,

  starts_at TIMESTAMPTZ NOT NULL,
  timezone VARCHAR(100) NOT NULL,
  duration_minutes INTEGER NOT NULL
    CHECK (duration_minutes BETWEEN 5 AND 1440),

  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'NGN'
    CHECK (currency ~ '^[A-Z]{3}$'),

  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'filled', 'cancelled', 'expired')),

  buffer_organization_id TEXT NOT NULL,
  buffer_channel_id TEXT NOT NULL,
  buffer_post_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CHECK (length(trim(business_name)) > 0),
  CHECK (length(trim(service_name)) > 0),
  CHECK (length(trim(location)) > 0)
);

CREATE TABLE slot_requests (
  id UUID PRIMARY KEY,
  slot_id UUID NOT NULL REFERENCES slots(id),

  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(254) NOT NULL,
  message VARCHAR(500) NOT NULL DEFAULT '',

  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'declined', 'withdrawn')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CHECK (length(trim(customer_name)) > 0),
  CHECK (length(trim(customer_email)) > 0)
);

CREATE INDEX slots_owner_created_idx
  ON slots (owner_id, created_at DESC);

CREATE INDEX slot_requests_slot_idx
  ON slot_requests (slot_id);

CREATE UNIQUE INDEX one_confirmed_request_per_slot
  ON slot_requests (slot_id)
  WHERE status = 'confirmed';

COMMIT;

