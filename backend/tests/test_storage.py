import uuid
from pathlib import Path

import pytest

from app.core.errors import AppError
from app.providers.storage.local import LocalStorageProvider, stored_upload_name


def test_path_traversal_is_rejected(tmp_path: Path, monkeypatch):
    storage = LocalStorageProvider()
    storage.root = tmp_path.resolve()
    with pytest.raises(AppError):
        storage.resolve("../outside.mp4")


def test_internal_upload_name_stays_within_database_limit():
    original_name = (
        "Full Time Highlights - Korea Selatan 2-1 Ceko - FIFA World Cup 2026.mp4"
    )
    stored_name = stored_upload_name(Path(original_name).suffix.lower())

    assert len(stored_name) <= 100
    assert stored_name.endswith(".mp4")
    assert "Full Time Highlights" not in stored_name


def test_saves_video_chunks(tmp_path: Path):
    storage = LocalStorageProvider()
    storage.root = tmp_path.resolve()
    project_id = uuid.uuid4()

    path, size, checksum, stored_name = storage.save_video_chunks(
        project_id,
        [b"video-", b"content"],
        ".mp4",
    )

    assert path.read_bytes() == b"video-content"
    assert size == 13
    assert len(checksum) == 64
    assert stored_name.endswith(".mp4")
