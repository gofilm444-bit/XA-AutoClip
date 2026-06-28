import pytest

from app.core.errors import AppError
from app.services.source_metadata import (
    extract_youtube_video_id,
    is_youtube_url,
    parse_metadata,
    parse_youtube_api_response,
    parse_youtube_oembed,
    parse_youtube_page_description,
    validate_public_url,
)


def test_parses_open_graph_metadata():
    result = parse_metadata(
        """
        <html>
          <head>
            <meta property="og:title" content="Judul Video">
            <meta property="og:description" content="Ringkasan sumber">
            <meta property="og:site_name" content="Situs Kreator">
            <meta property="og:image" content="/thumbnail.jpg">
          </head>
        </html>
        """,
        "https://example.com/watch/123",
    )
    assert result["title"] == "Judul Video"
    assert result["description"] == "Ringkasan sumber"
    assert result["creator"] == "Situs Kreator"
    assert result["thumbnail_url"] == "https://example.com/thumbnail.jpg"


def test_rejects_loopback_url():
    with pytest.raises(AppError):
        validate_public_url("http://127.0.0.1/private")


def test_detects_youtube_urls():
    assert is_youtube_url("https://www.youtube.com/watch?v=abc")
    assert is_youtube_url("https://youtu.be/abc")
    assert not is_youtube_url("https://example.com/youtube")


def test_parses_youtube_oembed():
    result = parse_youtube_oembed(
        {
            "title": "Judul Video",
            "author_name": "Nama Kanal",
            "thumbnail_url": "https://i.ytimg.com/vi/abc/hqdefault.jpg",
        },
        "https://www.youtube.com/watch?v=abc",
    )
    assert result["title"] == "Judul Video"
    assert result["creator"] == "Nama Kanal"
    assert result["site_name"] == "YouTube"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.youtube.com/watch?v=abc_123", "abc_123"),
        ("https://youtu.be/abc-123?t=1", "abc-123"),
        ("https://www.youtube.com/shorts/abc_123", "abc_123"),
        ("https://www.youtube.com/embed/abc-123", "abc-123"),
    ],
)
def test_extracts_youtube_video_id(url, expected):
    assert extract_youtube_video_id(url) == expected


def test_parses_youtube_api_description():
    result = parse_youtube_api_response(
        {
            "items": [
                {
                    "snippet": {
                        "title": "Judul Video",
                        "description": "Deskripsi lengkap video.",
                        "channelTitle": "Nama Kanal",
                        "thumbnails": {
                            "default": {"url": "small.jpg", "width": 120, "height": 90},
                            "high": {"url": "large.jpg", "width": 480, "height": 360},
                        },
                    }
                }
            ]
        },
        "https://www.youtube.com/watch?v=abc_123",
    )
    assert result is not None
    assert result["description"] == "Deskripsi lengkap video."
    assert result["thumbnail_url"] == "large.jpg"


def test_parses_youtube_page_description():
    html = r'{"shortDescription":"Baris pertama\nBaris kedua \"penting\"."}'
    assert (
        parse_youtube_page_description(html)
        == 'Baris pertama\nBaris kedua "penting".'
    )
