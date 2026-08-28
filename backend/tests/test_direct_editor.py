import io
import uuid
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import routes
from app.db.session import Base, get_db
from app.main import app
from app.models import ProcessingJob, TranscriptSegment


def _make_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    return engine, testing_session


def _client(testing_session):
    def override_get_db():
        with testing_session() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def test_create_blank_manual_editor_returns_200_and_required_fields(monkeypatch):
    engine, testing_session = _make_engine()
    monkeypatch.setattr(
        routes,
        "process_project",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("process_project tidak boleh dipanggil")),
    )
    with _client(testing_session) as client:
        response = client.post("/api/projects/manual-editor/blank")
        assert response.status_code == 200, response.text
        body = response.json()
        assert uuid.UUID(body["project_id"])
        assert uuid.UUID(body["transformation_id"])
        assert body["editor_url"] == f"/transformations/{body['transformation_id']}"
        assert body["status"] == "transformation_draft"


def test_blank_editor_does_not_create_job_or_segment_or_call_ai(monkeypatch):
    engine, testing_session = _make_engine()
    monkeypatch.setattr(
        routes,
        "process_project",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("process_project tidak boleh dipanggil")),
    )
    with _client(testing_session) as client:
        body = client.post("/api/projects/manual-editor/blank").json()
        with testing_session() as db:
            assert db.query(ProcessingJob).count() == 0
            assert db.query(TranscriptSegment).count() == 0
        config = client.get(f"/api/transformations/{body['transformation_id']}").json()[
            "clipper_style_config"
        ]
        assert config["manual_editor_mode"] is True
        assert config["video_sequence"] == []
        assert config["audio_sequence"] == []
        assert config["media_sequence"] == []
        assert config["caption_timeline"] == []
        assert config["effect_timeline"] == []


def test_import_video_and_add_to_timeline(monkeypatch):
    engine, testing_session = _make_engine()
    monkeypatch.setattr(
        routes,
        "probe_media",
        lambda _path: SimpleNamespace(duration=12.0, width=1920, height=1080),
    )
    with _client(testing_session) as client:
        body = client.post("/api/projects/manual-editor/blank").json()
        transformation_id = body["transformation_id"]

        video_bytes = b"fake-video-bytes"
        upload_response = client.post(
            f"/api/transformations/{transformation_id}/media",
            files={"file": ("clip.mp4", io.BytesIO(video_bytes), "video/mp4")},
            data={"kind": "video"},
        )
        assert upload_response.status_code == 201, upload_response.text
        asset = upload_response.json()
        assert asset["kind"] == "video"
        assert asset["duration_seconds"] == 12.0
        assert asset["url"].endswith(f"/media/{asset['asset_id']}")

        timeline_response = client.post(
            f"/api/transformations/{transformation_id}/media/{asset['asset_id']}/add-to-timeline"
        )
        assert timeline_response.status_code == 200, timeline_response.text
        config = timeline_response.json()["clipper_style_config"]
        assert config["video_sequence"]
        assert config["video_sequence"][0]["source_end"] == 12.0
        with testing_session() as db:
            from app.models import ClipCandidate

            candidate = db.query(ClipCandidate).first()
            assert candidate.short_source_clip_path
            assert candidate.duration_seconds == 12.0


def test_media_list_and_serve(monkeypatch):
    engine, testing_session = _make_engine()
    monkeypatch.setattr(
        routes,
        "probe_media",
        lambda _path: SimpleNamespace(duration=5.0, width=1080, height=1920),
    )
    with _client(testing_session) as client:
        body = client.post("/api/projects/manual-editor/blank").json()
        transformation_id = body["transformation_id"]
        client.post(
            f"/api/transformations/{transformation_id}/media",
            files={"file": ("a.mp4", io.BytesIO(b"data"), "video/mp4")},
            data={"kind": "video"},
        )
        listing = client.get(f"/api/transformations/{transformation_id}/media")
        assert listing.status_code == 200
        assert len(listing.json()) == 1
