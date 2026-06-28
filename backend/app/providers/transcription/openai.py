from pathlib import Path

import httpx

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.providers.transcription.base import (
    TranscriptionResult,
    TranscriptionSegment,
)

MAX_AUDIO_BYTES = 25 * 1024 * 1024


class OpenAITranscriptionProvider:
    def transcribe(self, audio_path: Path, duration: float) -> TranscriptionResult:
        settings = get_settings()
        if not settings.openai_api_key:
            raise AppError(
                ErrorCode.TRANSCRIPTION_FAILED,
                "OPENAI_API_KEY belum diisi untuk speech-to-text asli.",
            )
        if audio_path.stat().st_size > MAX_AUDIO_BYTES:
            raise AppError(
                ErrorCode.TRANSCRIPTION_FAILED,
                "Audio melebihi batas 25 MB provider. Gunakan video lebih pendek.",
            )

        model = settings.transcription_model or "whisper-1"
        try:
            with audio_path.open("rb") as audio:
                response = httpx.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                    files={"file": (audio_path.name, audio, "audio/wav")},
                    data={
                        "model": model,
                        "response_format": "verbose_json",
                        "timestamp_granularities[]": "segment",
                    },
                    timeout=300,
                )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError, OSError) as exc:
            raise AppError(
                ErrorCode.TRANSCRIPTION_FAILED,
                "Speech-to-text OpenAI gagal. Periksa API key, koneksi, dan format audio.",
            ) from exc

        segments = [
            TranscriptionSegment(
                start=float(segment["start"]),
                end=float(segment["end"]),
                text=str(segment.get("text", "")).strip(),
            )
            for segment in payload.get("segments", [])
            if segment.get("text") and float(segment["end"]) > float(segment["start"])
        ]
        if not segments:
            raise AppError(
                ErrorCode.TRANSCRIPTION_FAILED,
                "Tidak ada ucapan yang berhasil ditranskripsikan dari audio.",
            )
        return TranscriptionResult(
            detected_language=str(payload.get("language") or "unknown"),
            duration=float(payload.get("duration") or duration),
            segments=segments,
            provider_name="openai",
            model_name=model,
        )
