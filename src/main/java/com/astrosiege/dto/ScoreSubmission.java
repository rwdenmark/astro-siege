package com.astrosiege.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Inbound score submission. The bounds here are a first gate; the controller then
 * verifies the run against its server-timed session and the score model. sessionId
 * is the id from POST /api/game/start; it's validated in the controller, not here,
 * so a missing one yields a clean "Score rejected" rather than a bean-validation 400.
 */
public record ScoreSubmission(
        @NotBlank @Size(max = 24) String name,
        @Min(0) @Max(10_000_000) int points,
        @Min(1) @Max(1000) int wave,
        @Min(0) @Max(86_400) int durationSeconds,
        String sessionId
) {
}
