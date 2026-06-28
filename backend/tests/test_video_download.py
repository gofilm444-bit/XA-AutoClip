import uuid

import pytest

from app.core.errors import AppError, ErrorCode
from app.services.video_download import download_page_video


def test_page_download_rejects_unsupported_site(monkeypatch):
    monkeypatch.setattr(
        "app.services.video_download.validate_public_url",
        lambda url: None,
    )

    with pytest.raises(AppError) as error:
        download_page_video(uuid.uuid4(), "https://example.com/watch/123")

    assert error.value.code == ErrorCode.UNSUPPORTED_FORMAT
    assert "YouTube" in error.value.message
