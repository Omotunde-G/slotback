CREATE TABLE business_email_senders (
  owner_id BIGINT NOT NULL REFERENCES business_owners(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  PRIMARY KEY (owner_id, business_name)
);
