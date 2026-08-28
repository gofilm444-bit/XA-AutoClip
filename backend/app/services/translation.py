import json
from time import perf_counter

import httpx
import structlog

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.services.usage_audit import estimate_ai_usage

LANGUAGE_NAMES = {
    "id": "Bahasa Indonesia",
    "en": "English",
}
LANGUAGE_ALIASES = {
    "bahasa indonesia": "id",
    "indonesian": "id",
    "id": "id",
    "english": "en",
    "en": "en",
}

logger = structlog.get_logger()


def normalize_language(value: str | None) -> str:
    if not value:
        return "unknown"
    return LANGUAGE_ALIASES.get(value.strip().lower(), value.strip().lower())


def _response_text(payload: dict) -> str:
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                return str(content.get("text", ""))
    return ""


def translate_texts(texts: list[str], target_language: str) -> list[str]:
    if not texts:
        return []
    settings = get_settings()
    if not settings.openai_api_key:
        raise AppError(
            ErrorCode.AI_PROVIDER_FAILED,
            "OPENAI_API_KEY diperlukan untuk menerjemahkan subtitle.",
        )
    language_name = LANGUAGE_NAMES.get(target_language)
    if not language_name:
        raise AppError(ErrorCode.AI_PROVIDER_FAILED, "Bahasa subtitle tidak didukung.")

    indexed_text = [{"index": index, "text": text} for index, text in enumerate(texts)]
    prompt = (
        f"Translate every text value into {language_name}. Preserve meaning, names, "
        "numbers, and spoken tone. Return only a JSON array with the same index and a "
        f"translated text field.\n\n{json.dumps(indexed_text, ensure_ascii=False)}"
    )
    started_at = perf_counter()
    logger.info(
        "subtitle_translation_ai_call",
        ai_call_type="subtitle_translation",
        provider="openai",
        model=settings.translation_model,
        source_language="unknown",
        target_language=target_language,
        subtitle_count=len(texts),
        **estimate_ai_usage(
            "subtitle_translation", "openai", settings.translation_model,
            input_text_length=len(prompt),
        ),
    )
    logger.info(
        "ai_call_started",
        ai_call_type="subtitle_translation",
        provider="openai",
        model=settings.translation_model,
        target_language=target_language,
        subtitle_count=len(texts),
        retry_count=0,
        **estimate_ai_usage(
            "subtitle_translation", "openai", settings.translation_model,
            input_text_length=len(prompt),
        ),
    )
    try:
        response = httpx.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.translation_model,
                "input": prompt,
            },
            timeout=120,
        )
        response.raise_for_status()
        translated = json.loads(_response_text(response.json()))
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
        logger.warning(
            "ai_call_failed",
            ai_call_type="subtitle_translation",
            provider="openai",
            model=settings.translation_model,
            target_language=target_language,
            subtitle_count=len(texts),
            error=str(exc),
            request_duration_ms=round((perf_counter() - started_at) * 1000),
            **estimate_ai_usage(
                "subtitle_translation", "openai", settings.translation_model,
                input_text_length=len(prompt),
            ),
        )
        raise AppError(
            ErrorCode.AI_PROVIDER_FAILED,
            "Penerjemahan subtitle gagal. Coba ulang atau gunakan bahasa asli.",
        ) from exc

    by_index = {int(item["index"]): str(item["text"]).strip() for item in translated}
    if len(by_index) != len(texts):
        raise AppError(
            ErrorCode.AI_PROVIDER_FAILED,
            "Hasil terjemahan subtitle tidak lengkap.",
        )
    logger.info(
        "ai_call_completed",
        ai_call_type="subtitle_translation",
        provider="openai",
        model=settings.translation_model,
        target_language=target_language,
        subtitle_count=len(texts),
        request_duration_ms=round((perf_counter() - started_at) * 1000),
        cache_hit=False,
        **estimate_ai_usage(
            "subtitle_translation", "openai", settings.translation_model,
            input_text_length=len(prompt),
        ),
    )
    return [by_index[index] for index in range(len(texts))]
