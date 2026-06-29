package com.astrosiege.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SubmissionRateLimiterTest {

    private final SubmissionRateLimiter limiter = new SubmissionRateLimiter();

    // MAX_PER_WINDOW is 10.
    @Test
    void allowsUpToTheLimitThenBlocks() {
        for (int i = 0; i < 10; i++) {
            assertThat(limiter.allow("client-a")).as("call %d", i).isTrue();
        }
        assertThat(limiter.allow("client-a")).isFalse();
    }

    @Test
    void keysAreIndependent() {
        for (int i = 0; i < 10; i++) {
            limiter.allow("client-a");
        }
        assertThat(limiter.allow("client-a")).isFalse();
        assertThat(limiter.allow("client-b")).isTrue();
    }
}
