import uuid
from types import SimpleNamespace

from fastapi import Response
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import routes
from app.core.state import ProjectStatus
from app.db.session import Base
from app.models import (
    ClipCandidate,
    MediaAsset,
    ProcessingJob,
    Project,
    TranscriptSegment,
    TransformationPlan,
)
from app.services.render_plan import build_editor_render_plan


def test_manual_editor_creates_ai_free_editor_state_and_is_idempotent(tmp_path, monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    source_path = tmp_path / "manual.mp4"
    source_path.write_bytes(b"test-video")
    project_id = uuid.uuid4()
    events = []

    monkeypatch.setattr(
        routes,
        "probe_media",
        lambda _path: SimpleNamespace(
            duration=42.5,
            width=1920,
            height=1080,
            frame_rate=30.0,
            audio_sample_rate=48000,
            has_audio=True,
        ),
    )
    monkeypatch.setattr(
        routes.logger,
        "info",
        lambda event, **fields: events.append((event, fields)),
    )

    with testing_session() as db:
        project = Project(
            id=project_id,
            title="Manual video",
            description=None,
            content_type="podcast",
            status=ProjectStatus.UPLOADED,
            transcript_language=None,
            transcript_provider=None,
            deleted_at=None,
        )
        asset = MediaAsset(
            project_id=project_id,
            asset_type="source_video",
            original_filename="manual.mp4",
            stored_filename="manual.mp4",
            storage_path=str(source_path),
            mime_type="video/mp4",
            size_bytes=source_path.stat().st_size,
            duration_seconds=None,
            width=None,
            height=None,
            frame_rate=None,
            audio_sample_rate=None,
            checksum="0" * 64,
        )
        db.add_all([project, asset])
        db.commit()

        first = routes.create_manual_editor(project_id, Response(), db)
        second = routes.create_manual_editor(project_id, Response(), db)

        assert first["transformation_id"] == second["transformation_id"]
        assert first["editor_url"] == f"/transformations/{first['transformation_id']}"
        assert first["status"] == "ready_for_edit"
        assert first["duration"] == 42.5
        assert project.status == ProjectStatus.TRANSFORMATION_DRAFT
        assert project.transcript_provider == "manual_skipped"
        assert db.scalar(
            select(func.count(TranscriptSegment.id)).where(
                TranscriptSegment.project_id == project_id
            )
        ) == 0
        assert db.scalar(
            select(func.count(ProcessingJob.id)).where(ProcessingJob.project_id == project_id)
        ) == 0

        candidates = list(
            db.scalars(select(ClipCandidate).where(ClipCandidate.project_id == project_id))
        )
        plans = list(
            db.scalars(
                select(TransformationPlan).where(TransformationPlan.project_id == project_id)
            )
        )
        assert len(candidates) == 1
        assert len(plans) == 1
        assert candidates[0].category == "manual_editor"
        assert candidates[0].short_source_clip_path == str(source_path)
        assert candidates[0].start_seconds == 0
        assert candidates[0].end_seconds == 42.5

        config = plans[0].clipper_style_config
        assert config["manual_editor_mode"] is True
        assert config["caption_timeline"] == []
        assert config["effect_timeline"] == []
        assert config["hook_text"] == ""
        assert config["video_sequence"] == [
            {"id": "manual-video-1", "source_start": 0.0, "source_end": 42.5}
        ]

        render_plan = build_editor_render_plan(config, candidate_duration=42.5)
        assert render_plan.editor_state_found is True
        assert render_plan.video_sequence == config["video_sequence"]
        assert render_plan.audio_sequence == config["video_sequence"]
        assert render_plan.caption_timeline == []
        assert render_plan.effect_timeline == []
        assert routes.project_summary(project, db)["manual_editor_url"] == first["editor_url"]

    event_names = [event for event, _fields in events]
    assert "manual_editor_project_created" in event_names
    assert "manual_editor_source_ready" in event_names
    assert "manual_editor_editor_state_created" in event_names
    assert "manual_editor_ai_skipped" in event_names
