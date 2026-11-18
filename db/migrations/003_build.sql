-- M4: learned skill ranks and rune attunement/progress.
ALTER TABLE characters
  ADD COLUMN skills JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN runes  JSONB NOT NULL DEFAULT '{"slots":[],"lv":{},"xp":{}}'::jsonb;
