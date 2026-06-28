package com.astrosiege.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;

@Entity
public class Score {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank
    @Size(max = 24)
    @Column(length = 24, nullable = false)
    private String name;

    @Min(0)
    private int points;

    @Min(1)
    private int wave;

    @Min(0)
    private int durationSeconds;

    private Instant submittedAt;

    public Score() {
    }

    public Score(String name, int points, int wave, int durationSeconds) {
        this.name = name;
        this.points = points;
        this.wave = wave;
        this.durationSeconds = durationSeconds;
        this.submittedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public int getPoints() {
        return points;
    }

    public int getWave() {
        return wave;
    }

    public int getDurationSeconds() {
        return durationSeconds;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }
}
