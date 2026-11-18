-- M10: per-account client settings. One JSON document with a section per feature:
-- "audio" now (volumes, mute and on/off switches); key bindings, language and graphics later.
-- Every section is validated by the server when written and again when read.
CREATE TABLE account_settings (
  account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
