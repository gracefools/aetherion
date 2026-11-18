-- Friends: `a` asked `b`; the link counts for both once accepted.
CREATE TABLE IF NOT EXISTS friends (
  a BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  b BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  accepted BOOLEAN NOT NULL DEFAULT false,
  since TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (a, b),
  CHECK (a <> b)
);
CREATE INDEX IF NOT EXISTS friends_b_idx ON friends(b);
