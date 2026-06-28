package com.astrosiege.controller;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Liveness probe for Render's health check and the portfolio's Live Demo failover.
 * Returns 200 immediately, then asynchronously runs SELECT 1 to wake the database
 * (it auto-suspends on the free tier) before the visitor lands. CORS is opened to
 * the portfolio origin and the Tailscale Funnel host.
 */
@RestController
public class HealthController {

    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @CrossOrigin(origins = {
            "https://rwdenmark.github.io",
            "https://rdenmark.savannah-luma.ts.net"
    })
    @GetMapping("/api/health")
    public Map<String, String> health() {
        CompletableFuture.runAsync(() -> {
            try {
                jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            } catch (Exception ignored) {
                // Warm-up is best-effort. Never fail the health response because of it.
            }
        });
        return Map.of("status", "ok");
    }
}
