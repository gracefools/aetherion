-- T4: moderation. Administrators (is_admin, or listed in ADMIN_USERS) can ban an account (refused at
-- login and when joining), mute it (chat refused) and audit a character. Every action is logged.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ban_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS mod_log (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT NOT NULL,
  detail  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS mod_log_target_idx ON mod_log(lower(target), at DESC);
