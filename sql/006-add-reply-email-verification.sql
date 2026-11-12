BEGIN;

ALTER TABLE business_email_senders
  ADD COLUMN reply_code_hash TEXT,
  ADD COLUMN reply_code_expires_at TIMESTAMPTZ,
  ADD COLUMN reply_code_requested_at TIMESTAMPTZ,
  ADD COLUMN reply_code_attempts INTEGER NOT NULL DEFAULT 0;

COMMIT;
