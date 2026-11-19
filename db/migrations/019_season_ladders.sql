-- G7: seasonal ladders (a season is a calendar month) and which seasons have been paid out.
CREATE TABLE IF NOT EXISTS season_scores (
  season TEXT NOT NULL,
  ladder TEXT NOT NULL,
  character_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  job TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season, ladder, character_id)
);
CREATE INDEX IF NOT EXISTS season_scores_rank ON season_scores (season, ladder, score DESC);
CREATE TABLE IF NOT EXISTS season_paid (
  season TEXT NOT NULL,
  ladder TEXT NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season, ladder)
);
