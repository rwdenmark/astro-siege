package com.astrosiege.service;

import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-memory sliding-window rate limiter, keyed by client. Single-instance only,
 * matching the free-tier deployment; move to a shared store to scale out.
 */
@Service
public class SubmissionRateLimiter {

    private static final int MAX_PER_WINDOW = 10;
    private static final long WINDOW_MS = 60_000;
    private static final int SWEEP_EVERY = 500; // sweep idle clients every N calls

    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();
    private final AtomicInteger callsSinceSweep = new AtomicInteger();

    public boolean allow(String key) {
        long now = System.currentTimeMillis();
        if (callsSinceSweep.incrementAndGet() >= SWEEP_EVERY) {
            callsSinceSweep.set(0);
            sweepExpired(now);
        }
        Deque<Long> window = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() > WINDOW_MS) {
                window.pollFirst();
            }
            if (window.size() >= MAX_PER_WINDOW) {
                return false;
            }
            window.addLast(now);
            return true;
        }
    }

    // Drop clients whose window has fully aged out. The key is removed only if still
    // mapped to the same empty deque, so a racing allow() at worst lets one through.
    private void sweepExpired(long now) {
        for (Map.Entry<String, Deque<Long>> entry : hits.entrySet()) {
            Deque<Long> window = entry.getValue();
            synchronized (window) {
                while (!window.isEmpty() && now - window.peekFirst() > WINDOW_MS) {
                    window.pollFirst();
                }
                if (window.isEmpty()) {
                    hits.remove(entry.getKey(), window);
                }
            }
        }
    }
}
