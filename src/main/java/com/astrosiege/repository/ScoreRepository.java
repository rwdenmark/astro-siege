package com.astrosiege.repository;

import com.astrosiege.model.Score;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ScoreRepository extends JpaRepository<Score, Long> {

    // One board per mode. Highest points first; ties broken by the shorter run.
    List<Score> findAllByModeOrderByPointsDescDurationSecondsAsc(String mode, Pageable pageable);
}
