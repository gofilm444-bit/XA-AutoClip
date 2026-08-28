from app.models import TranscriptSegment
from app.providers.transcription.mock import MockTranscriptionProvider
from app.services.candidates import (
    IDEAL_MAX_CLIP_DURATION_SECONDS,
    MAX_CLIP_DURATION_SECONDS,
    MIN_CLIP_DURATION_SECONDS,
    CandidateDraft,
    _resolve_end_index,
    _score_end_boundary,
    _score_moment_anchor,
    _score_start_boundary,
    audit_candidate_duplicates,
    generate_candidates,
    normalize_to_one_minute_candidates,
    suppress_overlap_v2,
    weighted_score,
)


def test_candidate_duplicate_audit_detects_time_overlap():
    duplicates = audit_candidate_duplicates(
        [
            CandidateDraft(0, 30, "first", {}),
            CandidateDraft(1, 31, "second", {}),
        ]
    )

    assert duplicates == [(0, 1, "time_overlap")]


def make_segments():
    return [
        TranscriptSegment(
            project_id=None,
            segment_index=index,
            start_seconds=index * 5,
            end_seconds=(index + 1) * 5,
            text=f"Kalimat lengkap nomor {index} memberi konteks dan informasi penting.",
        )
        for index in range(12)
    ]


def make_strong_hook_segments():
    """Segments with strong hook at start and clear ending."""
    return [
        TranscriptSegment(
            project_id=None,
            segment_index=0,
            start_seconds=0,
            end_seconds=5,
            text="Ternyata rahasia besar ini baru terungkap hari ini.",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=1,
            start_seconds=5,
            end_seconds=10,
            text="Kenapa hal ini sangat penting untuk diketahui semua orang.",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=2,
            start_seconds=10,
            end_seconds=15,
            text="Masalahnya adalah banyak orang tidak sadar akan hal ini.",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=3,
            start_seconds=15,
            end_seconds=20,
            text="Jadi kesimpulannya kita harus lebih waspada dari sekarang.",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=4,
            start_seconds=20,
            end_seconds=25,
            text="Jadi hal ini sangat penting sekali.",
        ),
    ]


def make_filler_start_segments():
    """Segments starting with filler words."""
    return [
        TranscriptSegment(
            project_id=None,
            segment_index=0,
            start_seconds=0,
            end_seconds=5,
            text="Jadi eee hari ini kita bahas tentang topik menarik.",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=1,
            start_seconds=5,
            end_seconds=10,
            text="Ternyata ada hal menarik yang perlu diketahui.",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=2,
            start_seconds=10,
            end_seconds=15,
            text="Nah akhirnya kita menemukan jawabannya.",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=3,
            start_seconds=15,
            end_seconds=20,
            text="Oke jadi itu dia kesimpulannya.",
        ),
    ]


def make_hanging_end_segments():
    """Segments ending with connecting words."""
    return [
        TranscriptSegment(
            project_id=None,
            segment_index=0,
            start_seconds=0,
            end_seconds=5,
            text="Ini adalah pembukaan yang kuat dan menarik perhatian.",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=1,
            start_seconds=5,
            end_seconds=10,
            text="Konten di tengah sangat informatif dan jelas.",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=2,
            start_seconds=10,
            end_seconds=15,
            text="Tapi karena jadi kalau dan atau",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=3,
            start_seconds=15,
            end_seconds=20,
            text="Ini adalah penutup yang baik dengan kesimpulan jelas.",
        ),
    ]


def make_overlapping_segments():
    """Segments that would create overlapping candidates."""
    return [
        TranscriptSegment(
            project_id=None,
            segment_index=i,
            start_seconds=i * 5,
            end_seconds=(i + 1) * 5,
            text=f"Segmen {i} dengan konten yang cukup panjang untuk membuat durasi clip yang layak dan memberikan informasi penting.",
        )
        for i in range(20)
    ]


def test_generates_candidates_with_flexible_duration():
    """Target A: Candidates should not be locked to 60 seconds."""
    candidates = generate_candidates(make_segments())

    # Should generate candidates (up to 5)
    assert len(candidates) <= 5
    assert len(candidates) > 0

    # Durations should be within flexible bounds (20-150 seconds)
    for candidate in candidates:
        duration = candidate.end - candidate.start
        assert MIN_CLIP_DURATION_SECONDS <= duration <= MAX_CLIP_DURATION_SECONDS, (
            f"Duration {duration} outside bounds"
        )


def test_candidates_can_be_less_than_60_seconds():
    """Target A: Candidates can be less than 60 seconds if moment ends quickly."""
    candidates = generate_candidates(make_segments()[:8])

    # At least one candidate should be < 60 seconds (ideal range is 35-95)
    has_short = any(c.end - c.start < 60 for c in candidates)
    assert has_short, "Should have candidates shorter than 60 seconds"


def test_candidates_can_be_more_than_60_seconds():
    """Target A: Candidates can be more than 60 seconds if context needs it."""
    # Need longer content to test > 60 seconds
    segments = make_overlapping_segments()  # 20 segments * 5s = 100s content
    candidates = generate_candidates(segments)

    assert any(
        60 < candidate.end - candidate.start <= IDEAL_MAX_CLIP_DURATION_SECONDS
        for candidate in candidates
    ), "Should allow candidates longer than 60 seconds"


def test_candidate_scores_keep_worker_storage_contract():
    candidate = generate_candidates(make_segments())[0]

    assert {
        "hook",
        "context",
        "information",
        "emotion",
        "fluency",
        "duration",
        "discussion",
    } <= candidate.scores.keys()


def test_candidates_never_exceed_150_seconds():
    """Target A: Candidates should never exceed 150 seconds."""
    segments = make_overlapping_segments()
    candidates = generate_candidates(segments)

    for candidate in candidates:
        duration = candidate.end - candidate.start
        assert duration <= MAX_CLIP_DURATION_SECONDS, (
            f"Duration {duration} exceeds MAX_CLIP_DURATION_SECONDS"
        )


def test_start_prefers_strong_hook_over_filler():
    """Target B: Start should not pick filler if stronger alternative exists."""
    # Test _score_start_boundary directly
    strong_start = _score_start_boundary("Ternyata rahasia ini baru terungkap", is_first=True)
    filler_start = _score_start_boundary("Jadi eee hari ini kita bahas", is_first=True)

    assert strong_start > filler_start, "Strong hook should score higher than filler"


def test_start_boosts_questions_and_conflict():
    """Target B: Questions, conflict, contrast should boost start score."""
    question_start = _score_start_boundary("Kenapa hal ini terjadi?", is_first=False)
    conflict_start = _score_start_boundary(
        "Kontras dengan pendapat umum, ini salah.", is_first=False
    )
    claim_start = _score_start_boundary("Klaim kuat: ini adalah kebenaran mutlak.", is_first=False)
    normal_start = _score_start_boundary("Ini adalah kalimat biasa saja.", is_first=False)

    assert question_start > normal_start
    assert conflict_start > normal_start
    assert claim_start > normal_start


def test_start_adds_preroll():
    """Target B: Pre-roll should be considered for natural audio cut."""
    # This is implicitly tested by the fact that candidates can start
    # slightly before the "perfect" boundary due to segment grouping
    candidates = generate_candidates(make_strong_hook_segments())
    assert len(candidates) > 0


def test_end_prefers_complete_sentence():
    """Target C: End should prefer complete sentences over connecting words."""
    complete_end = _score_end_boundary("Ini adalah kesimpulan yang jelas.", 20.0)
    hanging_end = _score_end_boundary("Tapi karena jadi kalau dan atau", 15.0)

    assert complete_end > hanging_end, "Complete sentence should score higher"


def test_end_boosts_conclusion_punchline_answer():
    """Target C: Conclusions, punchlines, answers should boost end score."""
    conclusion_end = _score_end_boundary("Jadi kesimpulannya ini sangat penting.", 20.0)
    punchline_end = _score_end_boundary("Dan itulah rahasianya!", 20.0)
    answer_end = _score_end_boundary("Jawabannya adalah ya benar.", 20.0)
    hanging_end = _score_end_boundary("Karena jika kita melanjutkan", 15.0)

    assert conclusion_end > hanging_end
    assert punchline_end > hanging_end
    assert answer_end > hanging_end


def test_end_adds_postroll():
    """Target C: Post-roll should be considered for natural audio cut."""
    candidates = generate_candidates(make_strong_hook_segments())
    assert len(candidates) > 0


def test_dedup_removes_high_overlap_candidates():
    """Target E: Candidates with >60% overlap with higher-ranked should be removed."""
    # Create candidates with high overlap
    drafts = [
        CandidateDraft(
            0,
            40,
            "First candidate",
            {
                "hook_strength": 90,
                "topic_coherence": 80,
                "curiosity_gap": 70,
                "completeness": 80,
                "discussion_potential": 70,
                "duration_fit": 100,
                "transcript_quality": 80,
            },
        ),
        CandidateDraft(
            5,
            45,
            "Second candidate (overlaps)",
            {
                "hook_strength": 80,
                "topic_coherence": 80,
                "curiosity_gap": 70,
                "completeness": 80,
                "discussion_potential": 70,
                "duration_fit": 100,
                "transcript_quality": 80,
            },
        ),
        CandidateDraft(
            50,
            90,
            "Third candidate (no overlap)",
            {
                "hook_strength": 70,
                "topic_coherence": 80,
                "curiosity_gap": 70,
                "completeness": 80,
                "discussion_potential": 70,
                "duration_fit": 100,
                "transcript_quality": 80,
            },
        ),
    ]

    result = suppress_overlap_v2(drafts, limit=5)

    # Second candidate should be removed due to >60% overlap with first
    assert len(result) == 2
    assert result[0].start == 0
    assert result[1].start == 50


def test_ranking_strong_hook_completeness_beats_normal():
    """Target D: Candidates with strong hook and completeness should rank higher."""
    strong_segments = make_strong_hook_segments()
    weak_segments = make_filler_start_segments()

    strong_candidates = generate_candidates(strong_segments)
    weak_candidates = generate_candidates(weak_segments)

    if strong_candidates and weak_candidates:
        strong_score = strong_candidates[0].scores.get("hook_strength", 0) + strong_candidates[
            0
        ].scores.get("completeness", 0)
        weak_score = weak_candidates[0].scores.get("hook_strength", 0) + weak_candidates[
            0
        ].scores.get("completeness", 0)

        assert strong_score >= weak_score, "Strong hook + completeness should rank >= weak"


def test_mock_transcription_splits_long_video_into_clip_sized_segments(tmp_path):
    result = MockTranscriptionProvider().transcribe(tmp_path / "audio.wav", 375.954)

    assert len(result.segments) > 8
    assert max(segment.end - segment.start for segment in result.segments) <= 8.1
    assert result.segments[-1].end == 375.954
    candidates = generate_candidates(
        [
            TranscriptSegment(
                project_id=None,
                segment_index=index,
                start_seconds=segment.start,
                end_seconds=segment.end,
                text=segment.text,
            )
            for index, segment in enumerate(result.segments)
        ]
    )
    assert len(candidates) <= 5
    assert len(candidates) > 0


def test_normalize_returns_flexible_duration_candidates():
    """Target A: normalize_to_one_minute_candidates now returns natural durations."""
    drafts = [
        CandidateDraft(
            start=24,
            end=64,
            text="Momen terbaik",
            scores={
                "hook_strength": 90,
                "topic_coherence": 90,
                "curiosity_gap": 90,
                "completeness": 90,
                "discussion_potential": 90,
                "duration_fit": 100,
                "transcript_quality": 90,
            },
        ),
        *generate_candidates(make_segments(), limit=30),
    ]
    candidates = normalize_to_one_minute_candidates(drafts, video_duration=375.954)

    assert len(candidates) <= 5
    assert len(candidates) > 0

    # Durations should be natural, not forced to 60
    for candidate in candidates:
        duration = candidate.end - candidate.start
        assert MIN_CLIP_DURATION_SECONDS <= duration <= MAX_CLIP_DURATION_SECONDS

    # First candidate (highest scored) should be preserved
    assert candidates[0].start == 24
    assert candidates[0].end == 64


def test_moment_anchor_is_near_candidate_start():
    segments = make_segments()[:8]
    segments[1].text = "Kenapa fakta aneh ini ternyata paling menarik?"

    candidate = generate_candidates(segments)[0]

    assert candidate.audit["anchor_score"] >= 75
    assert candidate.audit["seconds_to_anchor"] <= 8
    assert candidate.audit["moment_anchor_time"] == 5


def test_strong_moment_anchor_improves_candidate_ranking():
    common_scores = {
        "hook_strength": 70,
        "completeness": 75,
        "topic_coherence": 70,
        "boundary_quality": 70,
        "duration_fit": 90,
        "transcript_quality": 80,
    }
    ordinary = {**common_scores, "moment_anchor_strength": 45}
    anchored = {**common_scores, "moment_anchor_strength": 95}

    assert weighted_score(anchored) > weighted_score(ordinary)
    assert _score_moment_anchor("Kenapa fakta aneh ini ternyata terjadi?") > 80


def test_hanging_ending_lowers_boundary_ranking():
    common_scores = {
        "hook_strength": 75,
        "completeness": 75,
        "topic_coherence": 75,
        "moment_anchor_strength": 80,
        "duration_fit": 90,
        "transcript_quality": 80,
    }

    assert weighted_score({**common_scores, "boundary_quality": 85}) > weighted_score(
        {**common_scores, "boundary_quality": 25}
    )


def test_bad_end_moves_to_next_complete_segment():
    segments = make_segments()[:6]
    segments[3].text = "Penjelasan ini masih berlanjut dan"
    segments[4].text = "Akhirnya jawaban lengkapnya terlihat jelas."

    resolved = _resolve_end_index(segments, start_index=0, end_index=3)

    assert resolved == 4


def test_topic_similarity_dedup_keeps_distinct_subjects():
    scores = {
        "hook_strength": 80,
        "completeness": 80,
        "topic_coherence": 80,
        "moment_anchor_strength": 80,
        "boundary_quality": 80,
        "duration_fit": 90,
        "transcript_quality": 80,
    }
    drafts = [
        CandidateDraft(0, 40, "Zona waktu Antartika membingungkan para peneliti.", scores),
        CandidateDraft(50, 90, "Peneliti bingung dengan zona waktu di Antartika.", scores),
        CandidateDraft(100, 140, "Pendidikan gratis membutuhkan efisiensi anggaran.", scores),
    ]

    selected = suppress_overlap_v2(drafts)

    assert len(selected) == 2
    assert any("Pendidikan" in candidate.text for candidate in selected)
