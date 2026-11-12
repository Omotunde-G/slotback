BEGIN;

CREATE TABLE booking_email_outbox (
  request_id UUID PRIMARY KEY REFERENCES slot_requests(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  reply_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT
);

COMMIT;
