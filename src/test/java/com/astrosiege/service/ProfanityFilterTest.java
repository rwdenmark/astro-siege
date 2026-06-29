package com.astrosiege.service;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class ProfanityFilterTest {

    /** Test double that returns a fixed verdict and counts how often the network path runs. */
    private static class StubFilter extends ProfanityFilter {
        final AtomicInteger calls = new AtomicInteger();
        Boolean verdict;

        StubFilter(Boolean verdict) {
            this.verdict = verdict;
        }

        @Override
        protected Boolean queryRemote(String text) {
            calls.incrementAndGet();
            return verdict;
        }
    }

    @Test
    void blankNamesAreNeverProfaneAndSkipTheNetwork() {
        StubFilter filter = new StubFilter(true);

        assertThat(filter.isProfane(null)).isFalse();
        assertThat(filter.isProfane("   ")).isFalse();
        assertThat(filter.calls).hasValue(0);
    }

    @Test
    void cleanAndProfaneVerdictsArePassedThrough() {
        assertThat(new StubFilter(false).isProfane("ryan")).isFalse();
        assertThat(new StubFilter(true).isProfane("rude")).isTrue();
    }

    @Test
    void verdictsAreCachedPerNormalizedName() {
        StubFilter filter = new StubFilter(true);

        assertThat(filter.isProfane("Rude")).isTrue();
        assertThat(filter.isProfane("  rude ")).isTrue();

        assertThat(filter.calls).as("second lookup served from cache").hasValue(1);
    }

    @Test
    void upstreamFailureFailsOpenAndIsNotCached() {
        StubFilter filter = new StubFilter(null); // null means the upstream could not be reached

        assertThat(filter.isProfane("anything")).isFalse();
        assertThat(filter.isProfane("anything")).isFalse();

        assertThat(filter.calls).as("fail-open result is retried, not cached").hasValue(2);
    }
}
