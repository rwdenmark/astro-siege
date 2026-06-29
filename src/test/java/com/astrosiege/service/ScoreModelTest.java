package com.astrosiege.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ScoreModelTest {

    // shots = durationSeconds * 1000 / 200 = durationSeconds * 5, each worth 300.
    @Test
    void zeroDurationAllowsNoPoints() {
        assertThat(ScoreModel.maxPoints(0)).isZero();
    }

    @Test
    void boundScalesWithDuration() {
        assertThat(ScoreModel.maxPoints(1)).isEqualTo(5 * 300);
        assertThat(ScoreModel.maxPoints(10)).isEqualTo(10 * 5 * 300);
    }

    @Test
    void boundIsMonotonic() {
        assertThat(ScoreModel.maxPoints(100)).isGreaterThan(ScoreModel.maxPoints(99));
    }
}
