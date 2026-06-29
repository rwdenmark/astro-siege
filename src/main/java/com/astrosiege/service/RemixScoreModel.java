package com.astrosiege.service;

/**
 * Score bound for the Remix mode (the mouse-aimed gallery shooter in game.js).
 *
 * Remix holds the mouse to auto-fire, and each fire tick can destroy at most one
 * target under the crosshair. So points accrue no faster than
 * (max fire rate) x (best target value). The shuttle is the most valuable target, so
 * its value sets the per-hit ceiling. The constants are deliberately generous floors
 * (faster cadence, higher value than the client actually allows) so a fast, accurate
 * legitimate run is never rejected.
 *
 * Keep these in rough sync with game.js if the Remix fire cadence or scoring changes.
 */
public final class RemixScoreModel {

    // Fastest the turrets can land a damaging tick. The client fires slower than this.
    private static final int MIN_HIT_INTERVAL_MS = 80;
    // Highest-value target: the bonus UFO (up to 2500), with headroom over the client value.
    private static final int MAX_POINTS_PER_HIT = 2500;

    private RemixScoreModel() {
    }

    public static long maxPoints(int durationSeconds) {
        long hits = (long) durationSeconds * 1000 / MIN_HIT_INTERVAL_MS;
        return hits * MAX_POINTS_PER_HIT;
    }
}
