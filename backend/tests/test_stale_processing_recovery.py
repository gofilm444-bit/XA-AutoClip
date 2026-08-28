import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import routes
from app.core.state import ProjectStatus
from app.db.session import Base
from app.models import ProcessingJob, Project


def processing_project(status: ProjectStatus, updated_at: datetime):
    return SimpleNamespace(
        id=uuid.uuid4(),
        status=status,
        updated_at=updated_at,
    )


def test_recent_generating_candidates_project_is_not_stale():
    now = datetime.now(UTC)
    project = processing_project(ProjectStatus.GENERATING_CANDIDATES, now)
    job = SimpleNamespace(updated_at=now, id=uuid.uuid4())

    assert not routes.is_stale_processing_project(project, job, 0, 10, now=now)


def test_old_generating_candidates_without_candidates_is_stale():
    now = datetime.now(UTC)
    stale_at = now - timedelta(minutes=11)
    project = processing_project(ProjectStatus.GENERATING_CANDIDATES, stale_at)
    job = SimpleNamespace(updated_at=stale_at, id=uuid.uuid4())

    assert routes.is_stale_processing_project(project, job, 0, 10, now=now)
    assert not routes.is_stale_processing_project(project, job, 1, 10, now=now)


def test_stale_process_request_creates_new_job_and_closes_old_job(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    project_id = uuid.uuid4()
    old_job_id = uuid.uuid4()
    stale_at = datetime.now(UTC) - timedelta(minutes=20)
    with testing_session() as db:
        db.add(
            Project(
                id=project_id,
                title="Stale project",
                description=None,
                content_type="podcast",
                status=ProjectStatus.GENERATING_CANDIDATES,
                transcript_language="id",
                transcript_provider="groq",
                deleted_at=None,
                created_at=stale_at,
                updated_at=stale_at,
            )
        )
        db.add(
            ProcessingJob(
                id=old_job_id,
                project_id=project_id,
                job_type="full_pipeline",
                status="running",
                progress=80,
                current_step="Memberi skor kandidat",
                retry_count=0,
                created_at=stale_at,
                updated_at=stale_at,
            )
        )
        db.commit()

        queued = []
        events = []
        monkeypatch.setattr(
            routes,
            "get_settings",
            lambda: SimpleNamespace(processing_stale_timeout_minutes=10),
        )
        monkeypatch.setattr(
            routes.process_project,
            "delay",
            lambda *args: queued.append(args),
        )
        monkeypatch.setattr(
            routes.logger,
            "warning",
            lambda event, **fields: events.append((event, fields)),
        )

        status_before = routes.project_status(project_id, db)
        new_job = routes.start_processing(project_id, db)

        old_job = db.get(ProcessingJob, old_job_id)
        jobs = list(
            db.scalars(
                select(ProcessingJob)
                .where(ProcessingJob.project_id == project_id)
                .order_by(ProcessingJob.created_at)
            )
        )

    assert status_before["is_stale"] is True
    assert status_before["recovery_available"] is True
    assert new_job.id != old_job_id
    assert new_job.status == "queued"
    assert new_job.progress == 0
    assert new_job.current_step == "Menunggu pemulihan proses"
    assert old_job.status == "failed"
    assert old_job.error_code == "STALE_PROCESSING_RECOVERED"
    assert len(jobs) == 2
    assert queued == [(str(project_id), str(new_job.id))]
    assert events[0][0] == "stale_processing_project_recovered"
    assert events[0][1]["previous_job_id"] == str(old_job_id)
    assert events[0][1]["new_job_id"] == str(new_job.id)


@pytest.mark.parametrize(
    "status",
    [ProjectStatus.CANDIDATES_READY, ProjectStatus.COMPLETED],
)
def test_finished_project_is_not_reprocessed_by_process_endpoint(status, monkeypatch):
    project = processing_project(status, datetime.now(UTC) - timedelta(hours=1))

    class FakeDb:
        def get(self, model, item_id):
            return project

        def scalar(self, statement):
            return 0

    monkeypatch.setattr(
        routes,
        "get_settings",
        lambda: SimpleNamespace(processing_stale_timeout_minutes=10),
    )

    with pytest.raises(HTTPException) as exc_info:
        routes.start_processing(project.id, FakeDb())

    assert exc_info.value.status_code == 409
