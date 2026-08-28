import tempfile
from pathlib import Path
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.providers.transcription.base import (
    TranscriptionResult,
    TranscriptionSegment,
)
from app.providers.transcription.openai import _prepare_audio_files


class GroqTranscriptionProvider:
    provider_name = "groq"

    @property
    def model(self) -> str:
        return get_settings().groq_transcription_model or "whisper-large-v3-turbo"

    def transcribe(self, audio_path: Path, duration: float) -> TranscriptionResult:
        settings = get_settings()
        if not settings.groq_api_key:
            raise AppError(
                ErrorCode.TRANSCRIPTION_FAILED,
                "GROQ_API_KEY belum diisi untuk transkripsi Groq.",
            )

        model = settings.groq_transcription_model or "whisper-large-v3-turbo"
        base_url = (settings.groq_transcription_base_url or "").rstrip("/")
        endpoint = f"{base_url}/audio/transcriptions"
        with tempfile.TemporaryDirectory() as temp_dir:
            prepared_files = _prepare_audio_files(audio_path, duration, Path(temp_dir))
            payloads = [
                _transcribe_file(
                    path,
                    model=model,
                    api_key=settings.groq_api_key,
                    endpoint=endpoint,
                    offset=offset,
                )
                for path, offset in prepared_files
            ]

        segments: list[TranscriptionSegment] = []
        detected_language = "unknown"
        reported_duration = duration
        response_texts: list[str] = []
        for payload in payloads:
            if detected_language == "unknown" and payload.get("language"):
                detected_language = str(payload["language"])
            if payload.get("duration"):
                reported_duration = max(reported_duration, float(payload["duration"]))
            if str(payload.get("text") or "").strip():
                response_texts.append(str(payload["text"]).strip())
            segments.extend(_normalize_segments(payload))

        segments.sort(key=lambda segment: (segment.start, segment.end))
        if not segments:
            raise AppError(
                ErrorCode.TRANSCRIPTION_FAILED,
                "Tidak ada ucapan yang berhasil ditranskripsikan dari audio Groq.",
            )
        return TranscriptionResult(
            detected_language=detected_language,
            duration=reported_duration,
            segments=segments,
            provider_name=self.provider_name,
            model_name=model,
            text=" ".join(response_texts)
            or " ".join(segment.text for segment in segments),
        )


def _normalize_segments(payload: dict[str, Any]) -> list[TranscriptionSegment]:
    normalized: list[TranscriptionSegment] = []
    payload_words = payload.get("words")
    for raw_segment in payload.get("segments") or []:
        text = str(raw_segment.get("text") or "").strip()
        try:
            start = float(raw_segment["start"])
            end = float(raw_segment["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if not text or end <= start:
            continue
        confidence = raw_segment.get("confidence")
        try:
            normalized_confidence = (
                float(confidence) if confidence is not None else None
            )
        except (TypeError, ValueError):
            normalized_confidence = None
        words = raw_segment.get("words")
        if not isinstance(words, list) and isinstance(payload_words, list):
            words = [
                word
                for word in payload_words
                if _word_overlaps_segment(word, start, end)
            ]
        normalized.append(
            TranscriptionSegment(
                start=start,
                end=end,
                text=text,
                confidence=normalized_confidence,
                words=words if isinstance(words, list) else None,
            )
        )
    return normalized


def _word_overlaps_segment(word: Any, start: float, end: float) -> bool:
    if not isinstance(word, dict):
        return False
    try:
        word_start = float(word["start"])
        word_end = float(word["end"])
    except (KeyError, TypeError, ValueError):
        return False
    return word_start < end and word_end > start


def _transcribe_file(
    audio_path: Path,
    *,
    model: str,
    api_key: str,
    endpoint: str,
    offset: float,
) -> dict[str, Any]:
    mime_type = "audio/mpeg" if audio_path.suffix.lower() == ".mp3" else "audio/wav"
    try:
        with audio_path.open("rb") as audio:
            response = httpx.post(
                endpoint,
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (audio_path.name, audio, mime_type)},
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
            "Speech-to-text Groq gagal. Periksa GROQ_API_KEY, koneksi, dan format audio.",
        ) from exc

    if not isinstance(payload, dict):
        raise AppError(
            ErrorCode.TRANSCRIPTION_FAILED,
            "Respons speech-to-text Groq tidak valid.",
        )
    if offset:
        for segment in payload.get("segments") or []:
            segment["start"] = float(segment["start"]) + offset
            segment["end"] = float(segment["end"]) + offset
            for word in segment.get("words") or []:
                if word.get("start") is not None:
                    word["start"] = float(word["start"]) + offset
                if word.get("end") is not None:
                    word["end"] = float(word["end"]) + offset
        for word in payload.get("words") or []:
            if word.get("start") is not None:
                word["start"] = float(word["start"]) + offset
            if word.get("end") is not None:
                word["end"] = float(word["end"]) + offset
    return payload
