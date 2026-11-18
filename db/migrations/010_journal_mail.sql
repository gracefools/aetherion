-- The adventurer's journal (achievements, titles, codex, missions, login streak) and player mail.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS journal JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS mail (
  id BIGSERIAL PRIMARY KEY,
  to_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  from_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  from_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  gold BIGINT NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read BOOLEAN NOT NULL DEFAULT false,
  claimed BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS mail_to ON mail(to_id, sent_at DESC);
