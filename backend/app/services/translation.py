import json

import httpx

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode

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
    return [by_index[index] for index in range(len(texts))]
