-- M11: each character's auto hunting configuration (thresholds, skill list, loot rules).
ALTER TABLE characters ADD COLUMN auto_hunt JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Player-to-player trades: an append-only audit log. One row per completed trade, written in the
-- same transaction that stores both inventories, so the log and the inventories cannot disagree.
CREATE TABLE trade_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  a_id       BIGINT NOT NULL,           -- character ids (kept even if a character is later deleted)
  b_id       BIGINT NOT NULL,
  a_name     TEXT NOT NULL,
  b_name     TEXT NOT NULL,
  zone_id    TEXT NOT NULL,
  a_gave     JSONB NOT NULL,            -- { gold, items: [{ base, rar, ilvl, up, qty, aff }] }
  b_gave     JSONB NOT NULL
);
CREATE INDEX trade_log_a_idx ON trade_log(a_id, at);
CREATE INDEX trade_log_b_idx ON trade_log(b_id, at);
