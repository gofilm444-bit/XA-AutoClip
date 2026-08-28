from types import SimpleNamespace

import pytest

import app.providers.transcription.factory as transcription_factory
import app.providers.transcription.groq as groq_transcription
import app.services.usage_audit as usage_audit
from app.core.errors import AppError, ErrorCode
from app.providers.transcription.groq import GroqTranscriptionProvider


class FakeGroqResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "text": "APBD kita harus rapi.",
            "language": "id",
            "duration": 7.5,
            "segments": [
                {
                    "start": 0.25,
                    "end": 3.5,
                    "text": "APBD kita",
                    "confidence": 0.91,
                },
                {
                    "start": 3.5,
                    "end": 7.5,
                    "text": "harus rapi.",
                },
            ],
            "words": [
                {"word": "APBD", "start": 0.25, "end": 0.8},
                {"word": "kita", "start": 0.8, "end": 1.2},
                {"word": "harus", "start": 3.5, "end": 4.0},
            ],
        }


def groq_settings(api_key="test-groq-key"):
    return SimpleNamespace(
        groq_api_key=api_key,
        groq_transcription_model="whisper-large-v3-turbo",
        groq_transcription_base_url="https://api.groq.com/openai/v1",
    )


def test_factory_selects_groq_provider(monkeypatch):
    monkeypatch.setattr(
        transcription_factory,
        "get_settings",
        lambda: SimpleNamespace(transcription_provider="groq"),
    )

    provider = transcription_factory.get_transcription_provider()

    assert isinstance(provider, GroqTranscriptionProvider)
    assert provider.provider_name == "groq"


@pytest.mark.parametrize(
    ("provider_name", "expected_class_name"),
    [("mock", "MockTranscriptionProvider"), ("openai", "OpenAITranscriptionProvider")],
)
def test_factory_keeps_existing_providers(
    monkeypatch,
    provider_name,
    expected_class_name,
):
    monkeypatch.setattr(
        transcription_factory,
        "get_settings",
        lambda: SimpleNamespace(transcription_provider=provider_name),
    )

    assert (
        transcription_factory.get_transcription_provider().__class__.__name__
        == expected_class_name
    )


def test_groq_transcription_uses_expected_endpoint_model_and_normalizes_segments(
    tmp_path,
    monkeypatch,
):
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")
    calls = []
    monkeypatch.setattr(groq_transcription, "get_settings", groq_settings)

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        return FakeGroqResponse()

    monkeypatch.setattr(groq_transcription.httpx, "post", fake_post)

    result = GroqTranscriptionProvider().transcribe(audio_path, 7.5)

    assert calls[0][0] == "https://api.groq.com/openai/v1/audio/transcriptions"
    assert calls[0][1]["data"]["model"] == "whisper-large-v3-turbo"
    assert calls[0][1]["data"]["response_format"] == "verbose_json"
    assert result.provider_name == "groq"
    assert result.model_name == "whisper-large-v3-turbo"
    assert result.detected_language == "id"
    assert result.text == "APBD kita harus rapi."
    assert [segment.text for segment in result.segments] == [
        "APBD kita",
        "harus rapi.",
    ]
    assert result.segments[0].confidence == 0.91
    assert result.segments[0].words == [
        {"word": "APBD", "start": 0.25, "end": 0.8},
        {"word": "kita", "start": 0.8, "end": 1.2},
    ]


def test_groq_missing_api_key_has_clear_configuration_error(tmp_path, monkeypatch):
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")
    monkeypatch.setattr(
        groq_transcription,
        "get_settings",
        lambda: groq_settings(api_key=""),
    )

    with pytest.raises(AppError) as exc_info:
        GroqTranscriptionProvider().transcribe(audio_path, 1)

    assert exc_info.value.code == ErrorCode.TRANSCRIPTION_FAILED
    assert "GROQ_API_KEY" in exc_info.value.message


def test_groq_usage_logging_records_audio_minutes(monkeypatch):
    events = []
    monkeypatch.setattr(
        usage_audit.logger,
        "info",
        lambda event, **fields: events.append((event, fields)),
    )

    usage = usage_audit.estimate_ai_usage(
        "transcription",
        "groq",
        "whisper-large-v3-turbo",
        audio_duration_seconds=90,
    )

    assert usage["quantity"] == 1.5
    assert usage["unit"] == "audio_minutes"
    assert usage["estimated_cost"] is None
    assert events == [
        (
            "ai_usage_cost_estimated",
            {
                "call_type": "transcription",
                "provider": "groq",
                "model": "whisper-large-v3-turbo",
                **usage,
            },
        )
    ]
