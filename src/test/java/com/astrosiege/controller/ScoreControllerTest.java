package com.astrosiege.controller;

import com.astrosiege.model.Score;
import com.astrosiege.repository.ScoreRepository;
import com.astrosiege.service.GameSessionService;
import com.astrosiege.service.ProfanityFilter;
import com.astrosiege.service.SubmissionRateLimiter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.Pageable;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ScoreController.class)
class ScoreControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ScoreRepository scoreRepository;
    @MockBean
    private ProfanityFilter profanityFilter;
    @MockBean
    private SubmissionRateLimiter rateLimiter;
    @MockBean
    private GameSessionService sessions;

    private String body(String name, int points, int wave, int durationSeconds, String sessionId) {
        return """
                {"name":"%s","points":%d,"wave":%d,"durationSeconds":%d,"sessionId":"%s"}
                """.formatted(name, points, wave, durationSeconds, sessionId);
    }

    @BeforeEach
    void allowByDefault() {
        when(rateLimiter.allow(anyString())).thenReturn(true);
    }

    @Test
    void validSubmissionIsSaved() throws Exception {
        when(sessions.startMillis("sess-1")).thenReturn(System.currentTimeMillis() - 3_000);
        when(profanityFilter.isProfane("AAA")).thenReturn(false);
        when(sessions.consume("sess-1")).thenReturn(true);
        when(scoreRepository.save(any(Score.class))).thenAnswer(inv -> inv.getArgument(0));

        mockMvc.perform(post("/api/scores").contentType(MediaType.APPLICATION_JSON)
                        .content(body("AAA", 500, 2, 2, "sess-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("AAA"))
                .andExpect(jsonPath("$.points").value(500));

        verify(scoreRepository).save(any(Score.class));
    }

    @Test
    void rateLimitedSubmissionReturns429() throws Exception {
        when(rateLimiter.allow(anyString())).thenReturn(false);

        mockMvc.perform(post("/api/scores").contentType(MediaType.APPLICATION_JSON)
                        .content(body("AAA", 500, 2, 2, "sess-1")))
                .andExpect(status().isTooManyRequests());

        verify(scoreRepository, never()).save(any());
    }

    @Test
    void missingSessionIsRejected() throws Exception {
        when(sessions.startMillis(anyString())).thenReturn(null);

        mockMvc.perform(post("/api/scores").contentType(MediaType.APPLICATION_JSON)
                        .content(body("AAA", 500, 2, 2, "sess-1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Score rejected"));

        verify(scoreRepository, never()).save(any());
    }

    @Test
    void claimingMoreTimeThanElapsedIsRejected() throws Exception {
        when(sessions.startMillis("sess-1")).thenReturn(System.currentTimeMillis());

        mockMvc.perform(post("/api/scores").contentType(MediaType.APPLICATION_JSON)
                        .content(body("AAA", 100, 2, 100, "sess-1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Score rejected"));

        verify(scoreRepository, never()).save(any());
    }

    @Test
    void claimingMorePointsThanTheModelAllowsIsRejected() throws Exception {
        when(sessions.startMillis("sess-1")).thenReturn(System.currentTimeMillis() - 3_000);

        mockMvc.perform(post("/api/scores").contentType(MediaType.APPLICATION_JSON)
                        .content(body("AAA", 9_000_000, 2, 1, "sess-1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Score rejected"));

        verify(scoreRepository, never()).save(any());
    }

    @Test
    void profaneNameIsRejectedAndSessionIsNotConsumed() throws Exception {
        when(sessions.startMillis("sess-1")).thenReturn(System.currentTimeMillis() - 3_000);
        when(profanityFilter.isProfane(anyString())).thenReturn(true);

        mockMvc.perform(post("/api/scores").contentType(MediaType.APPLICATION_JSON)
                        .content(body("rude", 500, 2, 2, "sess-1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Name not allowed"));

        verify(sessions, never()).consume(anyString());
        verify(scoreRepository, never()).save(any());
    }

    @Test
    void alreadySubmittedRunIsRejected() throws Exception {
        when(sessions.startMillis("sess-1")).thenReturn(System.currentTimeMillis() - 3_000);
        when(profanityFilter.isProfane(anyString())).thenReturn(false);
        when(sessions.consume("sess-1")).thenReturn(false);

        mockMvc.perform(post("/api/scores").contentType(MediaType.APPLICATION_JSON)
                        .content(body("AAA", 500, 2, 2, "sess-1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Score rejected"));

        verify(scoreRepository, never()).save(any());
    }

    @Test
    void blankNameFailsBeanValidation() throws Exception {
        mockMvc.perform(post("/api/scores").contentType(MediaType.APPLICATION_JSON)
                        .content(body("", 500, 2, 2, "sess-1")))
                .andExpect(status().isBadRequest());

        verify(scoreRepository, never()).save(any());
    }

    @Test
    void remixModeUsesItsOwnHigherScoreCeiling() throws Exception {
        when(profanityFilter.isProfane(anyString())).thenReturn(false);
        when(scoreRepository.save(any(Score.class))).thenAnswer(inv -> inv.getArgument(0));
        // Points that exceed the classic ceiling but fit within the remix ceiling.
        when(sessions.startMillis("sess-r")).thenReturn(System.currentTimeMillis() - 3_000);
        when(sessions.consume("sess-r")).thenReturn(true);

        mockMvc.perform(post("/api/scores").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"AAA\",\"points\":7000,\"wave\":2,\"durationSeconds\":1,\"sessionId\":\"sess-r\",\"mode\":\"remix\"}"))
                .andExpect(status().isOk());

        when(sessions.startMillis("sess-c")).thenReturn(System.currentTimeMillis() - 3_000);
        mockMvc.perform(post("/api/scores").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"AAA\",\"points\":7000,\"wave\":2,\"durationSeconds\":1,\"sessionId\":\"sess-c\",\"mode\":\"classic\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void topReturnsTheLeaderboard() throws Exception {
        when(scoreRepository.findAllByModeOrderByPointsDescDurationSecondsAsc(anyString(), any(Pageable.class)))
                .thenReturn(List.of(new Score("AAA", 900, 5, 120, "classic")));

        mockMvc.perform(get("/api/scores/top").param("limit", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("AAA"))
                .andExpect(jsonPath("$[0].points").value(900));
    }
}
