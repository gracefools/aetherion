-- The Endless Rift: one row per climber per climb; the weekly leaderboard takes each character's best.
CREATE TABLE IF NOT EXISTS rift_scores (
  id BIGSERIAL PRIMARY KEY,
  week INTEGER NOT NULL,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  job TEXT NOT NULL,
  floor INTEGER NOT NULL,
  secs INTEGER NOT NULL,
  party INTEGER NOT NULL DEFAULT 1,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rift_scores_week ON rift_scores(week, floor DESC, secs);
