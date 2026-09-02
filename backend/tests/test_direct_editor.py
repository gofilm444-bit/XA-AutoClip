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


def test_import_media_does_not_mutate_timeline(monkeypatch):
    engine, testing_session = _make_engine()
    monkeypatch.setattr(
        routes,
        "probe_media",
        lambda _path: SimpleNamespace(duration=10.0, width=1920, height=1080),
    )
    with _client(testing_session) as client:
        body = client.post("/api/projects/manual-editor/blank").json()
        transformation_id = body["transformation_id"]

        # Upload Video A
        res_a = client.post(
            f"/api/transformations/{transformation_id}/media",
            files={"file": ("video_a.mp4", io.BytesIO(b"data_a"), "video/mp4")},
            data={"kind": "video"},
        )
        assert res_a.status_code == 201

        # Check transformation - timeline should still be empty!
        tx_data = client.get(f"/api/transformations/{transformation_id}").json()
        assert tx_data["clipper_style_config"]["video_sequence"] == []

        # Upload Video B
        res_b = client.post(
            f"/api/transformations/{transformation_id}/media",
            files={"file": ("video_b.mp4", io.BytesIO(b"data_b"), "video/mp4")},
            data={"kind": "video"},
        )
        assert res_b.status_code == 201

        # Check transformation again - timeline must NOT be mutated!
        tx_data2 = client.get(f"/api/transformations/{transformation_id}").json()
        assert tx_data2["clipper_style_config"]["video_sequence"] == []

        # Both assets should exist in media library
        listing = client.get(f"/api/transformations/{transformation_id}/media").json()
        assert len(listing) == 2


def test_add_multiple_videos_appends_to_timeline(monkeypatch):
    engine, testing_session = _make_engine()
    monkeypatch.setattr(
        routes,
        "probe_media",
        lambda _path: SimpleNamespace(duration=8.0, width=1920, height=1080),
    )
    with _client(testing_session) as client:
        body = client.post("/api/projects/manual-editor/blank").json()
        transformation_id = body["transformation_id"]

        # Upload Video A and Video B
        asset_a = client.post(
            f"/api/transformations/{transformation_id}/media",
            files={"file": ("video_a.mp4", io.BytesIO(b"data_a"), "video/mp4")},
            data={"kind": "video"},
        ).json()
        asset_b = client.post(
            f"/api/transformations/{transformation_id}/media",
            files={"file": ("video_b.mp4", io.BytesIO(b"data_b"), "video/mp4")},
            data={"kind": "video"},
        ).json()

        # Add Video A to timeline
        res_add_a = client.post(
            f"/api/transformations/{transformation_id}/media/{asset_a['asset_id']}/add-to-timeline"
        ).json()
        seq_a = res_add_a["clipper_style_config"]["video_sequence"]
        assert len(seq_a) == 1
        assert seq_a[0]["source_end"] == 8.0

        # Add Video B to timeline -> MUST APPEND, NOT REPLACE Video A!
        res_add_b = client.post(
            f"/api/transformations/{transformation_id}/media/{asset_b['asset_id']}/add-to-timeline"
        ).json()
        seq_b = res_add_b["clipper_style_config"]["video_sequence"]
        assert len(seq_b) == 2
        # Video A is still first segment
        assert seq_b[0]["source_end"] == 8.0
        # Video B is appended as second segment
        assert seq_b[1]["source_end"] == 8.0
        assert seq_b[0]["id"] != seq_b[1]["id"]
def test_add_to_timeline_creates_valid_duration_start_end(monkeypatch):
    engine, testing_session = _make_engine()
    monkeypatch.setattr(
        routes,
        "probe_media",
        lambda _path: SimpleNamespace(duration=8.5, width=1920, height=1080),
    )
    with _client(testing_session) as client:
        body = client.post("/api/projects/manual-editor/blank").json()
        transformation_id = body["transformation_id"]

        asset = client.post(
            f"/api/transformations/{transformation_id}/media",
            files={"file": ("video.mp4", io.BytesIO(b"data"), "video/mp4")},
            data={"kind": "video"},
        ).json()

        res = client.post(
            f"/api/transformations/{transformation_id}/media/{asset['asset_id']}/add-to-timeline"
        ).json()
        seq = res["clipper_style_config"]["video_sequence"]
        assert len(seq) == 1
        seg = seq[0]
        assert seg["duration"] == 8.5
        assert seg["duration"] > 0
        assert seg["end"] > seg["start"]
        assert seg["source_end"] > seg["source_start"]
        assert seg["start"] == 0.0
        assert seg["end"] == 8.5
        assert seg["source_start"] == 0.0
        assert seg["source_end"] == 8.5
        assert seg["asset_id"] == asset["asset_id"]


def test_adding_video_a_8s_then_video_b_7s(monkeypatch):
    engine, testing_session = _make_engine()
    probe_results = {
        "vid_a.mp4": SimpleNamespace(duration=8.0, width=1920, height=1080),
        "vid_b.mp4": SimpleNamespace(duration=7.0, width=1920, height=1080),
    }
    monkeypatch.setattr(
        routes,
        "probe_media",
        lambda path: probe_results.get(str(path).split("/")[-1].split("\\")[-1], SimpleNamespace(duration=8.0, width=1920, height=1080)),
    )
    with _client(testing_session) as client:
        body = client.post("/api/projects/manual-editor/blank").json()
        transformation_id = body["transformation_id"]

        # 1. Upload Video A (8s)
        asset_a = client.post(
            f"/api/transformations/{transformation_id}/media",
            files={"file": ("vid_a.mp4", io.BytesIO(b"data_a"), "video/mp4")},
            data={"kind": "video"},
        ).json()
        # Override duration for test
        asset_a["duration_seconds"] = 8.0

        # 2. Upload Video B (7s)
        asset_b = client.post(
            f"/api/transformations/{transformation_id}/media",
            files={"file": ("vid_b.mp4", io.BytesIO(b"data_b"), "video/mp4")},
            data={"kind": "video"},
        ).json()
        # Override duration for test
        with testing_session() as db:
            from app.models import MediaAsset
            ma_b = db.get(MediaAsset, uuid.UUID(asset_b["asset_id"]))
            ma_b.duration_seconds = 7.0
            db.add(ma_b)
            db.commit()

        # 3. Add Video A
        res_a = client.post(
            f"/api/transformations/{transformation_id}/media/{asset_a['asset_id']}/add-to-timeline"
        ).json()
        seq_a = res_a["clipper_style_config"]["video_sequence"]
        assert len(seq_a) == 1
        assert seq_a[0]["start"] == 0.0
        assert seq_a[0]["end"] == 8.0

        # 4. Add Video B
        res_b = client.post(
            f"/api/transformations/{transformation_id}/media/{asset_b['asset_id']}/add-to-timeline"
        ).json()
        seq_b = res_b["clipper_style_config"]["video_sequence"]
        assert len(seq_b) == 2

        # Video A: start 0, end 8
        assert seq_b[0]["start"] == 0.0
        assert seq_b[0]["end"] == 8.0
        assert seq_b[0]["source_start"] == 0.0
        assert seq_b[0]["source_end"] == 8.0
        assert seq_b[0]["duration"] == 8.0
        assert seq_b[0]["asset_id"] == asset_a["asset_id"]
        assert seq_b[0]["name"] == "vid_a.mp4"
        assert f"/media/{asset_a['asset_id']}" in seq_b[0]["source_url"]

        # Video B: start 8, end 15
        assert seq_b[1]["start"] == 8.0
        assert seq_b[1]["end"] == 15.0
        assert seq_b[1]["source_start"] == 0.0
        assert seq_b[1]["source_end"] == 7.0
        assert seq_b[1]["duration"] == 7.0
        assert seq_b[1]["asset_id"] == asset_b["asset_id"]
        assert seq_b[1]["name"] == "vid_b.mp4"
        assert f"/media/{asset_b['asset_id']}" in seq_b[1]["source_url"]
        assert seq_b[0]["asset_id"] != seq_b[1]["asset_id"]
        assert seq_b[0]["source_url"] != seq_b[1]["source_url"]


def test_normalize_media_sequence_preserves_all_metadata():
    from app.services.clipper_style import normalize_media_sequence

    raw_sequence = [
        {
            "id": "segment-1",
            "asset_id": "asset-uuid-1",
            "name": "clip_intro.mp4",
            "source_url": "/api/media/1",
            "source_path": "/storage/media/1.mp4",
            "start": 0.0,
            "end": 8.0,
            "duration": 8.0,
            "source_start": 0.0,
            "source_end": 8.0,
            "speed": 1.0,
            "locked": True,
            "visible": False,
            "muted": True,
        }
    ]

    normalized = normalize_media_sequence(raw_sequence)
    assert len(normalized) == 1
    item = normalized[0]
    assert item["id"] == "segment-1"
    assert item["asset_id"] == "asset-uuid-1"
    assert item["name"] == "clip_intro.mp4"
    assert item["source_url"] == "/api/media/1"
    assert item["source_path"] == "/storage/media/1.mp4"
    assert item["start"] == 0.0
    assert item["end"] == 8.0
    assert item["duration"] == 8.0
    assert item["source_start"] == 0.0
    assert item["source_end"] == 8.0
    assert item["speed"] == 1.0
    assert item["locked"] is True
    assert item["visible"] is False
    assert item["muted"] is True
