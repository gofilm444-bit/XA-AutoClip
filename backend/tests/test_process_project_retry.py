import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.tasks as tasks
from app.api import routes
from app.core.errors import AppError, ErrorCode
from app.core.state import ProjectStatus, validate_transition
from app.db.session import Base
from app.models import (
    ClipCandidate,
    MediaAsset,
    ProcessingJob,
    Project,
    TranscriptSegment,
)
from app.services.candidates import CandidateDraft


def project_with_status(status: ProjectStatus):
    return SimpleNamespace(id="project-1", status=status)


def test_transcript_reuse_bridges_extracting_audio_to_segmenting(monkeypatch):
    events = []
    project = project_with_status(ProjectStatus.EXTRACTING_AUDIO)
    monkeypatch.setattr(
        tasks.logger,
        "info",
        lambda event, **fields: events.append((event, fields)),
    )

    tasks.transition_to_segmenting(project, reuse_transcript=True)

    assert project.status == ProjectStatus.SEGMENTING
    assert events == [
        (
            "transcription_reuse_status_bridge",
            {
                "project_id": "project-1",
                "from_status": "extracting_audio",
                "bridge_status": "transcribing",
                "next_status": "segmenting",
            },
        )
    ]


def test_reuse_guard_does_not_require_transcription_provider(monkeypatch):
    provider_calls = []
    monkeypatch.setattr(
        tasks,
        "get_transcription_provider",
        lambda: provider_calls.append("called"),
    )
    project = project_with_status(ProjectStatus.EXTRACTING_AUDIO)

    reuse_transcript = tasks.should_reuse_transcript(8, force_reprocess=False)
    tasks.transition_to_segmenting(project, reuse_transcript=reuse_transcript)

    assert reuse_transcript is True
    assert provider_calls == []
    assert project.status == ProjectStatus.SEGMENTING


def test_normal_transcription_path_still_transitions_to_segmenting():
    project = project_with_status(ProjectStatus.TRANSCRIBING)

    tasks.transition_to_segmenting(project, reuse_transcript=False)

    assert project.status == ProjectStatus.SEGMENTING


def test_unrelated_invalid_transition_remains_rejected():
    with pytest.raises(ValueError, match="Transisi status tidak valid"):
        validate_transition(ProjectStatus.EXTRACTING_AUDIO, ProjectStatus.COMPLETED)


def test_missing_source_stops_before_transcription_and_logs_recovery(monkeypatch, tmp_path):
    events = []
    provider_calls = []
    project = project_with_status(ProjectStatus.UPLOADED)
    monkeypatch.setattr(
        tasks.logger,
        "warning",
        lambda event, **fields: events.append((event, fields)),
    )
    monkeypatch.setattr(
        tasks,
        "get_transcription_provider",
        lambda: provider_calls.append("called"),
    )

    with pytest.raises(AppError) as exc_info:
        tasks.ensure_source_file_available(
            project,
            tmp_path / "missing-source.mp4",
            transcript_segment_count=442,
            candidate_count=5,
            force_reprocess=False,
        )

    assert exc_info.value.code == ErrorCode.INVALID_VIDEO
    assert exc_info.value.status_code == 409
    assert "Upload/link ulang sumber video" in exc_info.value.message
    assert provider_calls == []
    assert events[0][0] == "process_project_source_missing"
    assert events[0][1]["transcript_segment_count"] == 442
    assert events[0][1]["candidate_count"] == 5
    assert events[0][1]["can_reuse_transcript"] is True


def test_failed_project_can_enter_existing_source_relink_flow(monkeypatch):
    events = []
    project = project_with_status(ProjectStatus.FAILED)
    monkeypatch.setattr(
        routes.logger,
        "info",
        lambda event, **fields: events.append((event, fields)),
    )

    routes.begin_source_recovery(project)

    assert project.status == ProjectStatus.UPLOADING
    assert events[0][0] == "source_recovery_relink_started"


def test_process_project_retry_reuses_transcript_and_reaches_candidates_ready(
    tmp_path,
    monkeypatch,
):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    project_id = uuid.uuid4()
    job_id = uuid.uuid4()
    source_path = tmp_path / "source.mp4"
    source_path.write_bytes(b"video")
    with testing_session() as db:
        db.add(
            Project(
                id=project_id,
                title="Retry transcript reuse",
                description=None,
                content_type="podcast",
                status=ProjectStatus.UPLOADED,
                transcript_language="id",
                transcript_provider="groq",
                deleted_at=None,
            )
        )
        db.add(
            ProcessingJob(
                id=job_id,
                project_id=project_id,
                job_type="full_pipeline",
                status="queued",
                progress=0,
                current_step="Menunggu",
                retry_count=1,
            )
        )
        db.add(
            MediaAsset(
                project_id=project_id,
                asset_type="source_video",
                original_filename="source.mp4",
                stored_filename="source.mp4",
                storage_path=str(source_path),
                mime_type="video/mp4",
                size_bytes=source_path.stat().st_size,
                duration_seconds=30,
                width=1920,
                height=1080,
                frame_rate=30,
                audio_sample_rate=16000,
                checksum="source-checksum",
            )
        )
        db.add(
            TranscriptSegment(
                project_id=project_id,
                segment_index=0,
                start_seconds=0,
                end_seconds=30,
                text="Transkrip Groq yang sudah tersimpan digunakan kembali.",
                confidence=0.95,
                words_json=None,
            )
        )
        db.commit()

    provider_calls = []
    monkeypatch.setattr(tasks, "SessionLocal", testing_session)
    monkeypatch.setattr(
        tasks,
        "get_transcription_provider",
        lambda: provider_calls.append("called"),
    )
    monkeypatch.setattr(
        tasks,
        "probe_media",
        lambda path: SimpleNamespace(
            duration=30,
            width=1920,
            height=1080,
            frame_rate=30,
            audio_sample_rate=16000,
            has_audio=True,
        ),
    )

    def fake_extract_audio(source, destination, has_audio):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"audio")

    def fake_write_media(source, destination, *args):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"media")

    class FakeStorage:
        def resolve(self, relative_path):
            return tmp_path / relative_path

    scores = {
        "hook": 80,
        "context": 80,
        "information": 80,
        "emotion": 80,
        "fluency": 80,
        "duration": 80,
        "discussion": 80,
    }
    monkeypatch.setattr(tasks, "LocalStorageProvider", FakeStorage)
    monkeypatch.setattr(tasks, "extract_audio", fake_extract_audio)
    monkeypatch.setattr(tasks, "extract_clip", fake_write_media)
    monkeypatch.setattr(tasks, "extract_thumbnail", fake_write_media)
    monkeypatch.setattr(
        tasks,
        "generate_candidates",
        lambda segments, limit: [
            CandidateDraft(
                start=0,
                end=30,
                text=segments[0].text,
                scores=scores,
            )
        ],
    )

    tasks.process_project.run(str(project_id), str(job_id), False)

    with testing_session() as db:
        project = db.get(Project, project_id)
        job = db.get(ProcessingJob, job_id)
        transcript_count = db.scalar(
            select(func.count(TranscriptSegment.id)).where(
                TranscriptSegment.project_id == project_id
            )
        )
        candidate_count = db.scalar(
            select(func.count(ClipCandidate.id)).where(
                ClipCandidate.project_id == project_id
            )
        )

    assert provider_calls == []
    assert project.status == ProjectStatus.CANDIDATES_READY
    assert job.status == "completed"
    assert transcript_count == 1
    assert candidate_count == 1
