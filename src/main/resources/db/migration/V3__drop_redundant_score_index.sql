-- The mode-less index from V1 is unused since V2: every leaderboard query filters by
-- mode, so idx_score_mode_points_duration covers it. Drop the redundant one.
DROP INDEX IF EXISTS idx_score_points_duration;
