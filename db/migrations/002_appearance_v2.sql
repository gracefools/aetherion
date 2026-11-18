-- M2: upgrade M1 appearances ({skin, hair, hairColor, outfit}) to the v2 modular schema.
-- Weapon/armor defaults are neutral; job-specific looks are chosen in the creator for new characters.
UPDATE characters
SET appearance = jsonb_build_object(
  'v', 2, 'body', 0, 'build', 1, 'height', 1,
  'skin', LEAST(COALESCE((appearance->>'skin')::int, 1), 7),
  'face', 0, 'eyes', 0, 'eyeColor', 1,
  'hair', LEAST(COALESCE((appearance->>'hair')::int, 0), 7),
  'hairColor', LEAST(COALESCE((appearance->>'hairColor')::int, 1), 9),
  'clothing', 0,
  'color1', LEAST(COALESCE((appearance->>'outfit')::int, 1), 11),
  'color2', 6,
  'armor', 0, 'armorColor', 6, 'helmet', 0, 'helmetColor', 6, 'weapon', 0,
  'cape', 0, 'capeColor', 0, 'accessory', 0, 'accessoryColor', 0, 'aura', 0)
WHERE NOT (appearance ? 'v');

ALTER TABLE characters ADD CONSTRAINT characters_appearance_v2 CHECK (COALESCE((appearance->>'v')::int, 0) = 2);
