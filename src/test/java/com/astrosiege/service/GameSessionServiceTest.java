package com.astrosiege.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GameSessionServiceTest {

    private final GameSessionService sessions = new GameSessionService();

    @Test
    void startIssuesALiveSession() {
        long before = System.currentTimeMillis();
        String id = sessions.start();

        assertThat(id).isNotBlank();
        Long startMillis = sessions.startMillis(id);
        assertThat(startMillis).isNotNull();
        assertThat(startMillis).isGreaterThanOrEqualTo(before);
    }

    @Test
    void startMillisIsNullForUnknownOrNullId() {
        assertThat(sessions.startMillis(null)).isNull();
        assertThat(sessions.startMillis("not-a-real-id")).isNull();
    }

    @Test
    void aSessionCanBeConsumedOnlyOnce() {
        String id = sessions.start();

        assertThat(sessions.consume(id)).isTrue();
        assertThat(sessions.consume(id)).isFalse();
        assertThat(sessions.startMillis(id)).isNull();
    }

    @Test
    void consumeIsFalseForUnknownOrNullId() {
        assertThat(sessions.consume(null)).isFalse();
        assertThat(sessions.consume("not-a-real-id")).isFalse();
    }
}
