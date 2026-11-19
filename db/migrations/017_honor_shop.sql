-- G8: honour can be spent at the Arena Master. What was earned stays in honor (rankings); what was spent is kept apart.
ALTER TABLE pvp_stats ADD COLUMN IF NOT EXISTS honor_spent INTEGER NOT NULL DEFAULT 0;
