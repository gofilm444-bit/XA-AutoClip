from app.services.source_context import (
    content_title_from_filename,
    source_mismatch_warning,
)


def test_extracts_content_title_from_uploaded_filename():
    assert content_title_from_filename(
        "Full Time Highlights - Korea Selatan 2-1 Ceko - FIFA World Cup 2026.mp4"
    ) == "Full Time Highlights - Korea Selatan 2-1 Ceko - FIFA World Cup 2026"


def test_warns_when_uploaded_video_and_source_title_do_not_match():
    warning = source_mismatch_warning(
        "Full Time Highlights - Korea Selatan 2-1 Ceko.mp4",
        "HIGHLIGHT | MEKSIKO VS AFRIKA SELATAN | SKOR 2-0",
    )
    assert warning is not None


def test_accepts_matching_uploaded_video_and_source_title():
    warning = source_mismatch_warning(
        "Full Time Highlights - Korea Selatan 2-1 Ceko.mp4",
        "HIGHLIGHT | KOREA SELATAN VS CEKO | SKOR 2-1",
    )
    assert warning is None
