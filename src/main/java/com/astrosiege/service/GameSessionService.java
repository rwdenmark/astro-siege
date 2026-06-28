package com.astrosiege.service;

import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-memory game sessions keyed by an opaque id issued at run start. The server
 * records the start time so a submitted run can't claim more elapsed time than has
 * actually passed.
 *
 * Single-instance only, matching the deployment. Idle sessions are swept so the map
 * can't grow without bound over a long-lived process.
 */
@Service
public class GameSessionService {

    private static final long SESSION_TTL_MS = 86_400_000L; // 24h, matching the max run length
    private static final int SWEEP_EVERY = 500;

    private final Map<String, Long> sessions = new ConcurrentHashMap<>();
    private final AtomicInteger callsSinceSweep = new AtomicInteger();

    /** Open a session and return its id. */
    public String start() {
        long now = System.currentTimeMillis();
        if (callsSinceSweep.incrementAndGet() >= SWEEP_EVERY) {
            callsSinceSweep.set(0);
            sweepExpired(now);
        }
        String id = UUID.randomUUID().toString();
        sessions.put(id, now);
        return id;
    }

    /** Start time of a live session, or null if it is unknown or has expired. */
    public Long startMillis(String id) {
        if (id == null) return null;
        Long start = sessions.get(id);
        if (start == null) return null;
        if (System.currentTimeMillis() - start > SESSION_TTL_MS) {
            sessions.remove(id, start);
            return null;
        }
        return start;
    }

    /** Remove a session so a run can be submitted only once. True if it was present. */
    public boolean consume(String id) {
        return id != null && sessions.remove(id) != null;
    }

    private void sweepExpired(long now) {
        sessions.entrySet().removeIf(e -> now - e.getValue() > SESSION_TTL_MS);
    }
}
