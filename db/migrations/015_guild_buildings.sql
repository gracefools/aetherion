-- Guild buildings: levels bought with guild points (five points for each guild level).
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS buildings JSONB NOT NULL DEFAULT '{}'::jsonb;
