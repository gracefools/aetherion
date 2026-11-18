-- Ascension (level 70+): the chosen path, mastery points and saved skill loadouts.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS ascension JSONB NOT NULL DEFAULT '{}'::jsonb;
