-- Armament levels (one per equipment slot) and equipped sigils, stored with the character.
-- Written in the same statement as gold, inventory and equipment, so an enhancement and the
-- materials and gold it used are always saved together.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS gear JSONB NOT NULL DEFAULT '{}'::jsonb;
