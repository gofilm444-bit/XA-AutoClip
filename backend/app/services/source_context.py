import re
from pathlib import Path

TITLE_STOP_WORDS = {
    "2026",
    "fifa",
    "full",
    "group",
    "highlight",
    "highlights",
    "piala",
    "skor",
    "time",
    "vs",
    "world",
    "cup",
}


def content_title_from_filename(filename: str | None) -> str | None:
    if not filename:
        return None
    stem = Path(filename).stem
    clean = re.sub(r"[_|]+", " ", stem)
    clean = re.sub(r"\s+-\s+", " - ", clean)
    return re.sub(r"\s+", " ", clean).strip()[:300] or None


def significant_title_tokens(value: str | None) -> set[str]:
    if not value:
        return set()
    return {
        token
        for token in re.findall(r"[a-z0-9]+", value.lower())
        if len(token) >= 3 and token not in TITLE_STOP_WORDS
    }


def source_mismatch_warning(
    uploaded_filename: str | None,
    source_title: str | None,
) -> str | None:
    uploaded_tokens = significant_title_tokens(
        content_title_from_filename(uploaded_filename)
    )
    source_tokens = significant_title_tokens(source_title)
    if len(uploaded_tokens) < 2 or len(source_tokens) < 2:
        return None
    similarity = len(uploaded_tokens & source_tokens) / len(uploaded_tokens | source_tokens)
    if similarity >= 0.35:
        return None
    return (
        "Judul video unggahan tampak berbeda dari judul pada link sumber. "
        "Periksa kembali link sumber agar analisis, atribusi, dan caption tidak membahas "
        "pertandingan yang salah."
    )
