package com.astrosiege.controller;

import com.astrosiege.dto.ScoreSubmission;
import com.astrosiege.dto.ScoreView;
import com.astrosiege.model.Score;
import com.astrosiege.repository.ScoreRepository;
import com.astrosiege.service.GameSessionService;
import com.astrosiege.service.ProfanityFilter;
import com.astrosiege.service.RemixScoreModel;
import com.astrosiege.service.ScoreModel;
import com.astrosiege.service.SubmissionRateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/scores")
public class ScoreController {

    // Slack on the score-model bound: the player can also bank per-wave clear bonuses
    // that the per-shot ceiling doesn't model, so allow some headroom.
    private static final int POINTS_SLACK = 5_000;
    // The client's run clock can start slightly before the server creates the session
    // (request latency), so allow this much over the server-measured elapsed time.
    private static final int CLOCK_SKEW_SECONDS = 5;

    private final ScoreRepository scoreRepository;
    private final ProfanityFilter profanityFilter;
    private final SubmissionRateLimiter rateLimiter;
    private final GameSessionService sessions;

    public ScoreController(ScoreRepository scoreRepository,
                           ProfanityFilter profanityFilter,
                           SubmissionRateLimiter rateLimiter,
                           GameSessionService sessions) {
        this.scoreRepository = scoreRepository;
        this.profanityFilter = profanityFilter;
        this.rateLimiter = rateLimiter;
        this.sessions = sessions;
    }

    @PostMapping
    public ResponseEntity<?> submit(@Valid @RequestBody ScoreSubmission submission,
                                    HttpServletRequest request) {
        if (!rateLimiter.allow(clientKey(request))) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("message", "Too many submissions. Try again shortly."));
        }
        // The run must come from a real session, can't claim more time than has elapsed
        // since it started, and can't claim more points than the firing model allows.
        Long startMillis = sessions.startMillis(submission.sessionId());
        if (startMillis == null) {
            return rejected();
        }
        long elapsedSeconds = (System.currentTimeMillis() - startMillis) / 1000;
        if (submission.durationSeconds() > elapsedSeconds + CLOCK_SKEW_SECONDS) {
            return rejected();
        }
        String mode = normalizeMode(submission.mode());
        long maxPoints = "remix".equals(mode)
                ? RemixScoreModel.maxPoints(submission.durationSeconds())
                : ScoreModel.maxPoints(submission.durationSeconds());
        if (submission.points() > maxPoints + POINTS_SLACK) {
            return rejected();
        }
        // Checked before consuming the session so a profane name can be fixed and resubmitted.
        if (profanityFilter.isProfane(submission.name())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "Name not allowed"));
        }
        if (!sessions.consume(submission.sessionId())) {
            return rejected(); // already submitted, or swept between the checks
        }
        Score score = new Score(submission.name(), submission.points(),
                submission.wave(), submission.durationSeconds(), mode);
        Score saved = scoreRepository.save(score);
        return ResponseEntity.ok(ScoreView.from(saved));
    }

    // Anything that isn't "remix" lands on the classic board, so an unknown or missing
    // mode is a safe default rather than a rejection.
    private static String normalizeMode(String mode) {
        return "remix".equalsIgnoreCase(mode == null ? "" : mode.trim()) ? "remix" : "classic";
    }

    private ResponseEntity<?> rejected() {
        return ResponseEntity.badRequest().body(Map.of("message", "Score rejected"));
    }

    @GetMapping("/top")
    public List<ScoreView> top(@RequestParam(defaultValue = "10") int limit,
                               @RequestParam(defaultValue = "classic") String mode) {
        int capped = Math.min(Math.max(limit, 1), 100);
        return scoreRepository
                .findAllByModeOrderByPointsDescDurationSecondsAsc(normalizeMode(mode), PageRequest.of(0, capped))
                .stream()
                .map(ScoreView::from)
                .toList();
    }

    private String clientKey(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            // First hop is the client behind a proxy. Client-settable, so it only
            // stops casual spam, not a caller who rotates the header.
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
