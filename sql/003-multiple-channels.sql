BEGIN;

CREATE TABLE slot_channels (
  slot_id UUID NOT NULL REFERENCES slots(id),
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  service TEXT NOT NULL,

  buffer_post_id TEXT,
  buffer_status TEXT,

  PRIMARY KEY (slot_id, channel_id)
);

INSERT INTO slot_channels (
  slot_id,
  channel_id,
  channel_name,
  service,
  buffer_post_id
)
SELECT
  id,
  buffer_channel_id,
  buffer_channel_id,
  'unknown',
  buffer_post_id
FROM slots
WHERE buffer_channel_id IS NOT NULL;

ALTER TABLE slots
  ALTER COLUMN buffer_channel_id DROP NOT NULL;

COMMIT;
