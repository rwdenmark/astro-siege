package com.astrosiege.service;

import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Profanity filter backed by the free PurgoMalum REST API.
 *
 * Fail-open: on an upstream error or timeout, allow the submission rather than
 * block a legitimate player. The leaderboard is low-stakes.
 *
 * Verdicts are cached per normalized name, so repeat submissions skip the network.
 */
@Service
public class ProfanityFilter {

    private static final String CONTAINS_URL =
            "https://www.purgomalum.com/service/containsprofanity?text=";

    private static final int MAX_CACHE_ENTRIES = 1000;

    private final RestClient restClient = RestClient.builder()
            .requestFactory(timeoutFactory())
            .build();

    // Bounded LRU. A verdict never changes, so no TTL; the cap bounds the map.
    // Only real verdicts are cached, never the fail-open result.
    private final Map<String, Boolean> cache = Collections.synchronizedMap(
            new LinkedHashMap<String, Boolean>(16, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                    return size() > MAX_CACHE_ENTRIES;
                }
            });

    private static SimpleClientHttpRequestFactory timeoutFactory() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(2));
        factory.setReadTimeout(Duration.ofSeconds(3));
        return factory;
    }

    public boolean isProfane(String text) {
        if (text == null || text.isBlank()) return false;
        String key = text.trim().toLowerCase(Locale.ROOT);
        Boolean cached = cache.get(key);
        if (cached != null) return cached;
        Boolean verdict = queryRemote(text);
        if (verdict == null) return false; // upstream failed: fail open, don't cache
        cache.put(key, verdict);
        return verdict;
    }

    // Returns the upstream verdict, or null if it could not be obtained.
    protected Boolean queryRemote(String text) {
        try {
            String encoded = URLEncoder.encode(text, StandardCharsets.UTF_8);
            String body = restClient.get()
                    .uri(CONTAINS_URL + encoded)
                    .retrieve()
                    .body(String.class);
            return body != null && body.trim().equalsIgnoreCase("true");
        } catch (Exception e) {
            return null;
        }
    }
}
