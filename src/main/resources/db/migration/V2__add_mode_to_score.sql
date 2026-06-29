ALTER TABLE score ADD COLUMN mode VARCHAR(16) NOT NULL DEFAULT 'classic';

-- Per-mode leaderboard query: filter by mode, then ORDER BY points DESC, duration_seconds ASC.
CREATE INDEX idx_score_mode_points_duration ON score (mode, points DESC, duration_seconds ASC);
