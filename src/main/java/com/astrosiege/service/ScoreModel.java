package com.astrosiege.service;

/**
 * Mirror of the frontend firing model (game.js) so the server can bound the most
 * points a run of a given length could have produced, instead of a hand-tuned cap.
 *
 * The cannon fires one shot at a time and cannot fire again until its shot leaves
 * play, so points accrue no faster than (max fire rate) x (best target value). The
 * mystery ship is the most valuable target at 300, so that is the per-shot ceiling.
 *
 * Keep these constants in sync with game.js if the firing cadence or scoring changes.
 */
public final class ScoreModel {

    // The fastest the cannon can put a fresh shot on screen. A real shot takes far
    // longer (it has to clear the screen first), so this is a generous floor.
    private static final int MIN_SHOT_INTERVAL_MS = 200;
    // Highest-value target on the board: the mystery ship.
    private static final int MAX_POINTS_PER_SHOT = 300;

    private ScoreModel() {
    }

    /**
     * Upper bound on points reachable in {@code durationSeconds}: every shot fired at
     * the maximum cadence landing on the most valuable target.
     */
    public static long maxPoints(int durationSeconds) {
        long shots = (long) durationSeconds * 1000 / MIN_SHOT_INTERVAL_MS;
        return shots * MAX_POINTS_PER_SHOT;
    }
}
