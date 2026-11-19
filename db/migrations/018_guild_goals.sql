-- G9: each guild's weekly goals and their progress (the week number and a count per goal).
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS goals JSONB NOT NULL DEFAULT '{}'::jsonb;
