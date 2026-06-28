package com.astrosiege.repository;

import com.astrosiege.model.Score;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ScoreRepository extends JpaRepository<Score, Long> {

    // Highest points first; ties broken by the shorter run, matching the leaderboard query.
    List<Score> findAllByOrderByPointsDescDurationSecondsAsc(Pageable pageable);
}
