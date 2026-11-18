-- M8: what a character has found: waystones (for travel) and hidden caches (opened once).
ALTER TABLE characters ADD COLUMN discoveries JSONB NOT NULL DEFAULT '[]'::jsonb;
