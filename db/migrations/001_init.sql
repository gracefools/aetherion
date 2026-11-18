-- M1: accounts, sessions, characters (identity, appearance, position).
CREATE TABLE accounts (
  id             BIGSERIAL PRIMARY KEY,
  username       TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,           -- sha256 of the bearer token; raw token is never stored
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_account_idx ON sessions(account_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE characters (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  name_lower TEXT NOT NULL UNIQUE,
  job        TEXT NOT NULL CHECK (job IN ('knight','mage','ranger','assassin','cleric','berserker')),
  level      INT NOT NULL DEFAULT 1 CHECK (level >= 1),
  exp        BIGINT NOT NULL DEFAULT 0 CHECK (exp >= 0),
  appearance JSONB NOT NULL,
  zone_id    TEXT NOT NULL,
  pos_x      REAL NOT NULL,
  pos_y      REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX characters_account_idx ON characters(account_id);
