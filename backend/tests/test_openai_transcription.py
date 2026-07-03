from types import SimpleNamespace

import app.providers.transcription.openai as openai_transcription
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


def test_openai_transcription_chunks_large_audio_and_offsets_segments(tmp_path, monkeypatch):
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio larger than max")
    post_calls = []

    monkeypatch.setattr(openai_transcription, "MAX_AUDIO_BYTES", 10)
    monkeypatch.setattr(openai_transcription, "CHUNK_SECONDS", 10)
    monkeypatch.setattr(
        "app.providers.transcription.openai.get_settings",
        lambda: SimpleNamespace(
            openai_api_key="test-key",
            transcription_model="whisper-1",
        ),
    )

    def fake_transcode(source, destination, start=None, duration=None):
        destination.write_bytes(b"large-audio" if start is None else b"chunk")

    class ChunkResponse:
        def raise_for_status(self):
            return None

        def json(self):
            index = len(post_calls)
            post_calls.append(index)
            return {
                "language": "indonesian",
                "duration": 10,
                "segments": [
                    {"start": 1.0, "end": 3.0, "text": f"Bagian {index + 1}"},
                ],
            }

    monkeypatch.setattr(openai_transcription, "_transcode_for_openai", fake_transcode)
    monkeypatch.setattr(
        "app.providers.transcription.openai.httpx.post",
        lambda *args, **kwargs: ChunkResponse(),
    )

    result = OpenAITranscriptionProvider().transcribe(audio_path, 25)

    assert len(post_calls) == 3
    assert [segment.start for segment in result.segments] == [1.0, 11.0, 21.0]
    assert result.segments[2].text == "Bagian 3"
