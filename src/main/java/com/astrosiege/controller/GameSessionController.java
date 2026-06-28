package com.astrosiege.controller;

import com.astrosiege.service.GameSessionService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Opens a server-timed game session. The returned id is sent back with the score so
 * the server can check the run length against the real elapsed time.
 */
@RestController
@RequestMapping("/api/game")
public class GameSessionController {

    private final GameSessionService sessions;

    public GameSessionController(GameSessionService sessions) {
        this.sessions = sessions;
    }

    @PostMapping("/start")
    public Map<String, String> start() {
        return Map.of("sessionId", sessions.start());
    }
}
