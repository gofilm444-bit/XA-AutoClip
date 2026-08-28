import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import routes
from app.core.state import ProjectStatus
from app.db.session import Base, get_db
from app.main import app
from app.models import ClipCandidate, MediaAsset, Project, SourceDeclaration, TransformationPlan
from app.schemas.api import TransformationCreate, TransformationPatch


def _make_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    return engine, session_factory


def _seed(session_factory, monkeypatch):
    monkeypatch.setattr(
        routes,
        "generate_hook_text_for_clip",
        lambda *args, **kwargs: "hook cadangan",
    )
    project_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    plan_id = uuid.uuid4()
    source_path = "manual.mp4"
    with session_factory() as db:
        project = Project(
            id=project_id,
            title="Projek uji",
            description=None,
            content_type="podcast",
            status=ProjectStatus.UPLOADED,
            transcript_language=None,
            transcript_provider=None,
            deleted_at=None,
        )
        db.add(project)
        db.add(
            SourceDeclaration(
                project_id=project_id,
                ownership_type="unknown",
                intended_use="Uji autosave",
                transformation_purpose="analysis",
                user_acknowledged=True,
            )
        )
        db.add(
            MediaAsset(
                project_id=project_id,
                asset_type="source_video",
                original_filename="manual.mp4",
                stored_filename="manual.mp4",
                storage_path=source_path,
                mime_type="video/mp4",
                size_bytes=9,
                checksum="0" * 64,
            )
        )
        db.add(
            ClipCandidate(
                id=candidate_id,
                project_id=project_id,
                start_seconds=0,
                end_seconds=30,
                duration_seconds=30,
                transcript_text="Transkrip contoh untuk autosave.",
                suggested_title="Judul klip",
                suggested_hook="",
                summary="Ringkasan",
                category="manual_editor",
                hook_score=0,
                context_score=0,
                information_score=0,
                emotion_score=0,
                fluency_score=0,
                duration_score=0,
                discussion_score=0,
                viral_potential_score=0,
                reasons_json=[],
                risks_json=[],
                rank=1,
                selected=True,
                short_source_clip_path=source_path,
                file_missing=False,
            )
        )
        db.add(
            TransformationPlan(
                id=plan_id,
                project_id=project_id,
                candidate_id=candidate_id,
                purpose="analysis",
                audience="Penonton",
                new_angle="Sudut baru",
                original_hook="Hook awal",
                commentary_script="Naskah komentar awal.",
                conclusion="Kesimpulan awal.",
                engagement_question="Pertanyaan awal?",
                social_caption="Keterangan sosial awal.",
                clipper_style_config={"hook_text": "Hook awal"},
                needs_fact_verification=False,
                status="draft",
                storyboard=[],
            )
        )
        db.commit()
    return plan_id


def _client(engine, session_factory):
    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def test_patch_short_hook_returns_200(monkeypatch):
    engine, session_factory = _make_engine()
    plan_id = _seed(session_factory, monkeypatch)
    with _client(engine, session_factory) as client:
        response = client.patch(
            f"/api/transformations/{plan_id}",
            json={"original_hook": "h"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["original_hook"] == "h"


def test_patch_empty_description_returns_200(monkeypatch):
    engine, session_factory = _make_engine()
    plan_id = _seed(session_factory, monkeypatch)
    with _client(engine, session_factory) as client:
        response = client.patch(
            f"/api/transformations/{plan_id}",
            json={"commentary_script": ""},
        )
        assert response.status_code == 200, response.text
        assert response.json()["commentary_script"] == ""


def test_patch_empty_source_and_link_fields_returns_200(monkeypatch):
    engine, session_factory = _make_engine()
    plan_id = _seed(session_factory, monkeypatch)
    with _client(engine, session_factory) as client:
        response = client.patch(
            f"/api/transformations/{plan_id}",
            json={
                "new_angle": "",
                "social_caption": "",
                "engagement_question": "",
                "conclusion": "",
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["new_angle"] == ""
        assert body["social_caption"] == ""


def test_patch_editor_state_typography_returns_200(monkeypatch):
    engine, session_factory = _make_engine()
    plan_id = _seed(session_factory, monkeypatch)
    with _client(engine, session_factory) as client:
        response = client.patch(
            f"/api/transformations/{plan_id}",
            json={
                "clipper_style_config": {
                    "hook_text": "Teks hook contoh",
                    "caption_style": {
                        "preset": "clean_white",
                        "fontSize": "medium",
                        "textColor": "#FFFFFF",
                    },
                    "hook_text_enabled": True,
                }
            },
        )
        assert response.status_code == 200, response.text
        assert "hook_text" in response.json()["clipper_style_config"]


def test_patch_autosave_payload_with_short_fields_returns_200(monkeypatch):
    engine, session_factory = _make_engine()
    plan_id = _seed(session_factory, monkeypatch)
    with _client(engine, session_factory) as client:
        payload = {
            "purpose": "analysis",
            "audience": "Penonton",
            "new_angle": "a",
            "original_hook": "h",
            "commentary_script": "",
            "conclusion": "c",
            "engagement_question": "q",
            "social_caption": "",
            "storyboard": [],
            "clipper_style_config": {"hook_text": "h"},
        }
        response = client.patch(f"/api/transformations/{plan_id}", json=payload)
        assert response.status_code == 200, response.text


def test_create_schema_still_enforces_audience_length():
    with pytest.raises(ValidationError):
        TransformationCreate(purpose="analysis", audience="a")


def test_patch_schema_accepts_short_and_empty_values():
    patch = TransformationPatch(
        original_hook="h",
        commentary_script="",
        new_angle="",
        social_caption="",
        audience="",
    )
    assert patch.original_hook == "h"
    assert patch.commentary_script == ""
    assert patch.audience == ""
