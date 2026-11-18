-- Guild territory war (who holds each village) and faction conquest (weekly points per region).
CREATE TABLE IF NOT EXISTS territories (
  zone TEXT PRIMARY KEY,
  guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  since TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS faction_points (
  week INTEGER NOT NULL,
  zone TEXT NOT NULL,
  faction TEXT NOT NULL,
  points INTEGER NOT NULL,
  PRIMARY KEY (week, zone, faction)
);
