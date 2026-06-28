from types import SimpleNamespace

from app.providers.transcription.openai import OpenAITranscriptionProvider


class FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "language": "indonesian",
            "duration": 12.5,
            "segments": [
                {"start": 0.5, "end": 4.0, "text": "Komentator membuka pertandingan."},
                {"start": 4.0, "end": 8.5, "text": "Serangan datang dari sisi kanan."},
            ],
        }


def test_openai_transcription_returns_timestamped_segments(tmp_path, monkeypatch):
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")
    monkeypatch.setattr(
        "app.providers.transcription.openai.get_settings",
        lambda: SimpleNamespace(
            openai_api_key="test-key",
            transcription_model="whisper-1",
        ),
    )
    monkeypatch.setattr(
        "app.providers.transcription.openai.httpx.post",
        lambda *args, **kwargs: FakeResponse(),
    )

    result = OpenAITranscriptionProvider().transcribe(audio_path, 12.5)

    assert result.provider_name == "openai"
    assert result.detected_language == "indonesian"
    assert result.segments[0].start == 0.5
    assert result.segments[1].text == "Serangan datang dari sisi kanan."
