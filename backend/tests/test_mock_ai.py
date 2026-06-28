from app.models import ClipCandidate
from app.providers.ai.mock import MockAIProvider


def test_mock_ai_uses_uploaded_video_and_clip_timestamp():
    candidate = ClipCandidate(
        start_seconds=24,
        end_seconds=84,
        duration_seconds=60,
        suggested_title="Kandidat",
    )
    result = MockAIProvider().transformation(
        candidate,
        "analysis",
        "Penggemar sepak bola",
        "Rekap pertandingan.\nInstagram: https://example.com",
        "Meksiko vs Afrika Selatan",
        "Korea Selatan 2-1 Ceko.mp4",
    )

    assert "Korea Selatan 2-1 Ceko" in result["new_angle"]
    assert "00:24-01:24" in result["commentary_script"]
    assert "Instagram" not in result["commentary_script"]
