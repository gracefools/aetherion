-- M6: gold, inventory and equipment. Stored as one snapshot per character so a save is atomic.
ALTER TABLE characters
  ADD COLUMN gold      BIGINT NOT NULL DEFAULT 0 CHECK (gold >= 0),
  ADD COLUMN inventory JSONB  NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN equipment JSONB  NOT NULL DEFAULT '{}'::jsonb;
