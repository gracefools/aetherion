-- Life outside combat: professions, home (furniture, garden), season pass, wardrobe.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS life JSONB NOT NULL DEFAULT '{}'::jsonb;
