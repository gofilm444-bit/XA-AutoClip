import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import generate_auto_captions
from app.core.state import ProjectStatus
from app.db.session import Base
from app.models import (
    ClipCandidate,
    MediaAsset,
    Project,
    TranscriptSegment,
    TransformationPlan,
)
from app.schemas.api import EditorAutoCaptionRequest
from app.services.editor_captions import (
    project_cues_through_multi_video_sequence,
    generate_editor_auto_captions,
    project_cues_through_sequence,
    split_transcript_into_caption_cues,
)


def test_split_transcript_into_caption_cues_with_words():
    segments = [
        {
            "start": 0.0,
            "end": 4.0,
            "text": "Halo teman-teman semua selamat datang kembali di channel ini",
            "words": [
                {"word": "Halo", "start": 0.0, "end": 0.4},
                {"word": "teman-teman", "start": 0.45, "end": 0.9},
                {"word": "semua", "start": 0.95, "end": 1.3},
                {"word": "selamat", "start": 1.4, "end": 1.8},
                {"word": "datang", "start": 1.85, "end": 2.2},
                {"word": "kembali", "start": 2.3, "end": 2.8},
                {"word": "di", "start": 2.9, "end": 3.1},
                {"word": "channel", "start": 3.15, "end": 3.5},
                {"word": "ini", "start": 3.55, "end": 3.9},
            ],
        }
    ]
    cues = split_transcript_into_caption_cues(segments, max_words_per_cue=5, max_chars_per_cue=35)
    assert len(cues) >= 2
    for cue in cues:
        assert "id" in cue
        assert cue["end"] > cue["start"]
        assert len(cue["text"]) > 0


def test_split_transcript_into_caption_cues_proportional_fallback():
    segments = [
        {
            "start": 10.0,
            "end": 20.0,
            "text": "Ini adalah contoh kalimat panjang tanpa timestamp kata yang harus dibagi secara proporsional agar nyaman dibaca pada video portrait vertikal sembilan banding enam belas.",
        }
    ]
    cues = split_transcript_into_caption_cues(segments, max_words_per_cue=6, max_chars_per_cue=35)
    assert len(cues) >= 3
    assert cues[0]["start"] >= 10.0
    assert cues[-1]["end"] <= 20.0
    # Monotonically increasing
    for i in range(len(cues) - 1):
        assert cues[i]["start"] <= cues[i + 1]["start"]


def test_project_cues_through_sequence():
    cues = [
        {"id": "c1", "start": 2.0, "end": 4.0, "text": "Pertama"},
        {"id": "c2", "start": 6.0, "end": 8.0, "text": "Kedua"},
        {"id": "c3", "start": 12.0, "end": 14.0, "text": "Ketiga"},
    ]
    # Split cut video: source 0-5s -> timeline 0-5s; source 10-15s -> timeline 5-10s
    video_sequence = [
        {"id": "seg-1", "source_start": 0.0, "source_end": 5.0},
        {"id": "seg-2", "source_start": 10.0, "source_end": 15.0},
    ]
    projected = project_cues_through_sequence(cues, video_sequence)
    assert len(projected) == 2
    # First cue is in seg-1 (source 2-4 -> timeline 2-4)
    assert projected[0]["start"] == 2.0
    assert projected[0]["end"] == 4.0
    assert projected[0]["text"] == "Pertama"
    # Third cue is in seg-2 (source 12-14 -> timeline (5 + (12-10)) = 7-9)
    assert projected[1]["start"] == 7.0
    assert projected[1]["end"] == 9.0
    assert projected[1]["text"] == "Ketiga"


def test_generate_editor_auto_captions_reused_transcript(tmp_path, monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)

    project_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    transformation_id = uuid.uuid4()

    with testing_session() as db:
        project = Project(
            id=project_id,
            title="Test Project",
            content_type="podcast",
            status=ProjectStatus.TRANSFORMATION_DRAFT,
            transcript_language="id",
            transcript_provider="mock",
        )
        candidate = ClipCandidate(
            id=candidate_id,
            project_id=project_id,
            start_seconds=0.0,
            end_seconds=10.0,
            duration_seconds=10.0,
            transcript_text="Halo selamat datang",
            suggested_title="Video Utama",
            suggested_hook="",
            summary="",
            category="manual_editor",
            hook_score=0.0,
            context_score=0.0,
            information_score=0.0,
            emotion_score=0.0,
            fluency_score=0.0,
            duration_score=0.0,
            discussion_score=0.0,
            viral_potential_score=0.0,
            rank=1,
            selected=True,
            short_source_clip_path="",
        )
        plan = TransformationPlan(
            id=transformation_id,
            project_id=project_id,
            candidate_id=candidate_id,
            purpose="other",
            new_angle="",
            audience="",
            original_hook="",
            commentary_script="",
            conclusion="",
            engagement_question="",
            clipper_style_config={
                "caption_timeline": [{"id": "old-1", "start": 1.0, "end": 2.0, "text": "Old"}],
                "caption_timeline_initialized": True,
            },
        )
        # Add existing transcript segments
        seg = TranscriptSegment(
            project_id=project_id,
            segment_index=0,
            start_seconds=0.5,
            end_seconds=3.5,
            text="Halo selamat datang di video ini",
            confidence=0.98,
            words_json=[
                {"word": "Halo", "start": 0.5, "end": 1.0},
                {"word": "selamat", "start": 1.1, "end": 1.6},
                {"word": "datang", "start": 1.7, "end": 2.2},
                {"word": "di", "start": 2.3, "end": 2.6},
                {"word": "video", "start": 2.7, "end": 3.1},
                {"word": "ini", "start": 3.2, "end": 3.5},
            ],
        )
        db.add_all([project, candidate, plan, seg])
        db.commit()

        # Call endpoint with delete_current_captions=True
        req = EditorAutoCaptionRequest(
            language="id",
            delete_current_captions=True,
            identify_filler_words=True,
            bilingual="none",
        )
        res = generate_auto_captions(transformation_id, req, db)

        assert res["success"] is True
        assert res["reused_transcript"] is True
        assert res["cues_count"] > 0
        assert len(res["cues"]) > 0
        assert res["cues"][0]["text"].startswith("Halo")

        # Verify plan in DB updated
        updated_plan = db.scalar(
            select(TransformationPlan).where(TransformationPlan.id == transformation_id)
        )
        config = updated_plan.clipper_style_config
        assert config["caption_timeline_initialized"] is True
        assert len(config["caption_timeline"]) == res["cues_count"]
        # Old cue replaced
        assert not any(c.get("id") == "old-1" for c in config["caption_timeline"])


def test_generate_editor_auto_captions_missing_source_file(tmp_path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)

    project_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    transformation_id = uuid.uuid4()

    with testing_session() as db:
        project = Project(
            id=project_id,
            title="Missing File Project",
            content_type="podcast",
            status=ProjectStatus.UPLOADED,
        )
        candidate = ClipCandidate(
            id=candidate_id,
            project_id=project_id,
            start_seconds=0.0,
            end_seconds=10.0,
            duration_seconds=10.0,
            transcript_text="",
            suggested_title="Video Utama",
            suggested_hook="",
            summary="",
            category="manual_editor",
            hook_score=0.0,
            context_score=0.0,
            information_score=0.0,
            emotion_score=0.0,
            fluency_score=0.0,
            duration_score=0.0,
            discussion_score=0.0,
            viral_potential_score=0.0,
            rank=1,
            selected=True,
            short_source_clip_path=str(tmp_path / "non_existent_video.mp4"),
        )
        plan = TransformationPlan(
            id=transformation_id,
            project_id=project_id,
            candidate_id=candidate_id,
            purpose="other",
            new_angle="",
            audience="",
            original_hook="",
            commentary_script="",
            conclusion="",
            engagement_question="",
            clipper_style_config={},
        )
        db.add_all([project, candidate, plan])
        db.commit()

        req = EditorAutoCaptionRequest(
            language="id",
            delete_current_captions=True,
        )
        with pytest.raises(HTTPException) as exc_info:
            generate_auto_captions(transformation_id, req, db)

        assert exc_info.value.status_code == 404
        assert "File sumber tidak ditemukan" in exc_info.value.detail

# =========================================================================
# MULTI-VIDEO AUTO-CAPTION TESTS (TEST 1 - TEST 10)
# =========================================================================

def test_multi_video_auto_captions_distinct_asset_transcripts():
    # TEST 1 & TEST 2: Video A & Video B have distinct transcripts and mapped source_asset_id
    asset_transcripts = {
        "asset-A": [
            {"start": 0.5, "end": 4.0, "text": "Ini caption video pertama dari sumber A", "words": []},
            {"start": 4.5, "end": 7.5, "text": "Lanjutan ucapan pertama video satu", "words": []},
        ],
        "asset-B": [
            {"start": 0.5, "end": 3.5, "text": "Ini caption video kedua dari sumber B", "words": []},
            {"start": 4.0, "end": 6.5, "text": "Lanjutan ucapan kedua video dua", "words": []},
        ],
    }
    video_sequence = [
        {"id": "seg-1", "asset_id": "asset-A", "source_start": 0.0, "source_end": 8.0, "start": 0.0, "end": 8.0, "duration": 8.0, "speed": 1.0},
        {"id": "seg-2", "asset_id": "asset-B", "source_start": 0.0, "source_end": 7.0, "start": 8.0, "end": 15.0, "duration": 7.0, "speed": 1.0},
    ]

    projected = project_cues_through_multi_video_sequence(asset_transcripts, video_sequence)

    # 0-8s region belongs to Video A
    cues_a = [c for c in projected if c["end"] <= 8.0]
    # 8-15s region belongs to Video B
    cues_b = [c for c in projected if c["start"] >= 8.0]

    assert len(cues_a) > 0
    assert len(cues_b) > 0
    for c in cues_a:
        assert c["source_asset_id"] == "asset-A"
        assert c["source_segment_id"] == "seg-1"

    for c in cues_b:
        assert c["source_asset_id"] == "asset-B"
        assert c["source_segment_id"] == "seg-2"

    all_text_a = " ".join(c["text"].lower() for c in cues_a)
    all_text_b = " ".join(c["text"].lower() for c in cues_b)

    assert "pertama" in all_text_a
    assert "kedua" in all_text_b


def test_multi_video_caption_offset_and_trimming():
    # TEST 3 & TEST 4: Offset calculation & trimming logic
    asset_transcripts = {
        "asset-B": [
            {"start": 0.0, "end": 2.0, "text": "Satu dua tiga empat lima"},
            {"start": 3.0, "end": 4.0, "text": "Enam tujuh delapan sembilan sepuluh"},
        ]
    }
    # Case 1: un-trimmed segment starting at 8.0
    seq_untrimmed = [
        {"id": "seg-b", "asset_id": "asset-B", "source_start": 0.0, "source_end": 7.0, "start": 8.0, "end": 15.0, "duration": 7.0, "speed": 1.0}
    ]
    res1 = project_cues_through_multi_video_sequence(asset_transcripts, seq_untrimmed)
    assert res1[0]["start"] == 8.0
    assert res1[0]["end"] == 10.0

    # Case 2: trimmed segment (source 2-6, timeline start 8) -> cue at 3-4 maps to (8 + (3-2)) = 9.0 to 10.0
    seq_trimmed = [
        {"id": "seg-b", "asset_id": "asset-B", "source_start": 2.0, "source_end": 6.0, "start": 8.0, "end": 12.0, "duration": 4.0, "speed": 1.0}
    ]
    res2 = project_cues_through_multi_video_sequence(asset_transcripts, seq_trimmed)
    assert len(res2) == 1
    assert res2[0]["start"] == 9.0
    assert res2[0]["end"] == 10.0
    assert "tujuh" in res2[0]["text"]


def test_speed_compression_on_timeline_cues():
    # TEST 5: speed=2.0 compresses timing
    asset_transcripts = {
        "asset-A": [
            {"start": 0.0, "end": 4.0, "text": "Satu dua tiga empat lima"},
        ]
    }
    seq_fast = [
        {"id": "seg-fast", "asset_id": "asset-A", "source_start": 0.0, "source_end": 4.0, "start": 0.0, "end": 2.0, "duration": 2.0, "speed": 2.0}
    ]
    res = project_cues_through_multi_video_sequence(asset_transcripts, seq_fast)
    assert len(res) == 1
    # 0 to 4s at speed 2 -> 0 to 2s
    assert res[0]["start"] == 0.0
    assert res[0]["end"] == 2.0


def test_repeated_asset_in_sequence_reuses_transcript_without_duplication():
    # TEST 6: Sequence A -> B -> A requires only transcripts for A and B
    asset_transcripts = {
        "asset-A": [{"start": 0.0, "end": 3.0, "text": "Audio klip A satu dua tiga"}],
        "asset-B": [{"start": 0.0, "end": 3.0, "text": "Audio klip B empat lima enam"}],
    }
    video_sequence = [
        {"id": "seg-1", "asset_id": "asset-A", "source_start": 0.0, "source_end": 3.0, "start": 0.0, "end": 3.0, "speed": 1.0},
        {"id": "seg-2", "asset_id": "asset-B", "source_start": 0.0, "source_end": 3.0, "start": 3.0, "end": 6.0, "speed": 1.0},
        {"id": "seg-3", "asset_id": "asset-A", "source_start": 0.0, "source_end": 3.0, "start": 6.0, "end": 9.0, "speed": 1.0},
    ]
    res = project_cues_through_multi_video_sequence(asset_transcripts, video_sequence)
    assert len(res) == 3
    assert res[0]["source_segment_id"] == "seg-1"
    assert res[0]["source_asset_id"] == "asset-A"
    assert res[0]["start"] == 0.0

    assert res[1]["source_segment_id"] == "seg-2"
    assert res[1]["source_asset_id"] == "asset-B"
    assert res[1]["start"] == 3.0

    assert res[2]["source_segment_id"] == "seg-3"
    assert res[2]["source_asset_id"] == "asset-A"
    assert res[2]["start"] == 6.0


def test_auto_captions_preserves_video_sequence_deeply(tmp_path):
    # TEST 7: video_sequence is strictly preserved
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)

    project_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    transformation_id = uuid.uuid4()

    with testing_session() as db:
        project = Project(
            id=project_id,
            title="Multi Video Project",
            content_type="podcast",
            status=ProjectStatus.TRANSFORMATION_DRAFT,
            transcript_language="id",
            transcript_provider="mock",
        )
        candidate = ClipCandidate(
            id=candidate_id,
            project_id=project_id,
            start_seconds=0.0,
            end_seconds=15.0,
            duration_seconds=15.0,
            transcript_text="",
            suggested_title="Video Multi",
            suggested_hook="",
            summary="",
            category="manual_editor",
            hook_score=0.0,
            context_score=0.0,
            information_score=0.0,
            emotion_score=0.0,
            fluency_score=0.0,
            duration_score=0.0,
            discussion_score=0.0,
            viral_potential_score=0.0,
            rank=1,
            selected=True,
            short_source_clip_path="",
        )
        original_video_sequence = [
            {"id": "seg-1", "asset_id": "asset-1", "source_start": 0.0, "source_end": 8.0, "start": 0.0, "end": 8.0, "duration": 8.0, "speed": 1.0},
            {"id": "seg-2", "asset_id": "asset-2", "source_start": 0.0, "source_end": 7.0, "start": 8.0, "end": 15.0, "duration": 7.0, "speed": 1.0},
        ]
        plan = TransformationPlan(
            id=transformation_id,
            project_id=project_id,
            candidate_id=candidate_id,
            purpose="other",
            new_angle="",
            audience="",
            original_hook="",
            commentary_script="",
            conclusion="",
            engagement_question="",
            clipper_style_config={
                "video_sequence": original_video_sequence,
            },
        )
        db.add_all([project, candidate, plan])
        db.commit()

        # Cache mock transcripts for both assets on disk
        from app.providers.storage.local import LocalStorageProvider
        storage = LocalStorageProvider()
        t1_path = storage.resolve(f"{project_id}/transcripts/asset-1.json")
        t2_path = storage.resolve(f"{project_id}/transcripts/asset-2.json")
        t1_path.parent.mkdir(parents=True, exist_ok=True)
        import json
        with open(t1_path, "w", encoding="utf-8") as f:
            json.dump([{"start": 0.5, "end": 3.0, "text": "Caption dari video satu", "words": []}], f)
        with open(t2_path, "w", encoding="utf-8") as f:
            json.dump([{"start": 0.5, "end": 3.0, "text": "Caption dari video dua", "words": []}], f)

        req = EditorAutoCaptionRequest(
            language="id",
            delete_current_captions=True,
        )
        res = generate_auto_captions(transformation_id, req, db)

        assert res["success"] is True
        assert res["cues_count"] == 2
        assert res["cues"][0]["source_asset_id"] == "asset-1"
        assert res["cues"][1]["source_asset_id"] == "asset-2"

        # Verify video_sequence remained completely unchanged
        updated_plan = db.scalar(
            select(TransformationPlan).where(TransformationPlan.id == transformation_id)
        )
        assert updated_plan.clipper_style_config["video_sequence"] == original_video_sequence
