import re

from app.models import ClipCandidate, Project, SourceDeclaration, TransformationPlan

STOP_WORDS = {
    "a",
    "ada",
    "adalah",
    "akan",
    "and",
    "atau",
    "by",
    "dalam",
    "dan",
    "dari",
    "di",
    "dengan",
    "group",
    "ini",
    "ke",
    "of",
    "pada",
    "skor",
    "the",
    "untuk",
    "vs",
    "yang",
}
PROMOTIONAL_MARKERS = {
    "follow",
    "instagram",
    "official website",
    "subscribe",
    "temukan sosial media",
    "temukan website",
    "tiktok",
    "website official",
}


def naturalize_title(title: str) -> str:
    clean = re.sub(r"\s+", " ", title).strip()
    if clean.isupper():
        clean = clean.lower()
        clean = clean[:1].upper() + clean[1:]
    return clean.rstrip(".")


def summarize_source_description(description: str | None, max_chars: int = 360) -> str:
    if not description:
        return ""
    meaningful_lines: list[str] = []
    for raw_line in description.splitlines():
        line = raw_line.strip()
        lowered = line.lower()
        if (
            not line
            or line.startswith("#")
            or any(marker in lowered for marker in PROMOTIONAL_MARKERS)
        ):
            continue
        without_urls = re.sub(r"https?://\S+", "", line).strip(" -|")
        if without_urls and not without_urls.endswith(":"):
            meaningful_lines.append(without_urls)
    clean = re.sub(r"\s+", " ", " ".join(meaningful_lines)).strip()
    if len(clean) <= max_chars:
        return clean
    excerpt = clean[: max_chars + 1]
    sentence_end = max(excerpt.rfind(". "), excerpt.rfind("! "), excerpt.rfind("? "))
    if sentence_end >= max_chars // 2:
        return excerpt[: sentence_end + 1].strip()
    word_end = excerpt.rfind(" ")
    return f"{excerpt[:word_end].rstrip()}..."


def hashtag_token(value: str) -> str:
    parts = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9]+", value)
    return "".join(part[:1].upper() + part[1:].lower() for part in parts)


def generate_hashtags(title: str, limit: int = 5) -> list[str]:
    hashtags: list[str] = []
    seen: set[str] = set()
    sections = re.split(r"[|•—–]+", title)
    for section in sections:
        phrases = re.split(r"\bvs\.?\b", section, flags=re.IGNORECASE)
        for phrase in phrases:
            tokens = [
                token
                for token in re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9]+", phrase)
                if token.lower() not in STOP_WORDS
                and len(token) >= 3
                and not token.isdigit()
            ]
            if not tokens:
                continue
            hashtag = hashtag_token(" ".join(tokens[:3]))
            key = hashtag.lower()
            if hashtag and key not in seen:
                hashtags.append(f"#{hashtag}")
                seen.add(key)
            if len(hashtags) == limit:
                return hashtags
    if len(hashtags) < 2:
        for fallback in ("#Analisis", "#KontenKreator"):
            if fallback.lower() not in seen:
                hashtags.append(fallback)
            if len(hashtags) >= 2:
                break
    return hashtags[:limit]


def generate_social_caption(
    project: Project,
    declaration: SourceDeclaration,
    plan: TransformationPlan,
    candidate: ClipCandidate | None = None,
    content_title: str | None = None,
    include_source_context: bool = True,
) -> str:
    source_title = content_title or declaration.source_title or project.title
    natural_title = naturalize_title(source_title)
    source_name = declaration.source_creator or "Sumber asli"
    source_url = declaration.source_url or "Tidak dicantumkan"
    source_context = (
        summarize_source_description(declaration.source_description)
        if include_source_context
        else ""
    )
    hashtags = " ".join(generate_hashtags(source_title))
    context_block = f"\n\nKonteks pertandingan: {source_context}" if source_context else ""
    if project.content_type == "sports" and candidate:
        timestamp = (
            f"{int(candidate.start_seconds // 60):02d}:"
            f"{int(candidate.start_seconds % 60):02d}"
        )
        transcript_lines = [
            line.strip()
            for line in candidate.transcript_text.splitlines()
            if line.strip()
        ][:4]
        transcript_block = (
            "\n".join(transcript_lines)
            if transcript_lines
            else "Komentar pertandingan belum tersedia."
        )
        opening = transcript_lines[0] if transcript_lines else plan.original_hook.strip()
        return (
            f"{opening}\n\n"
            f"Highlight pertandingan mulai {timestamp}: {candidate.suggested_title}. "
            f"{plan.conclusion.strip()}\n\n"
            f"Komentar pada momen ini:\n{transcript_block}\n\n"
            f"{plan.engagement_question.strip()}\n\n"
            f"Sumber video: {natural_title}\n"
            f"Link sumber: {source_url}\n"
            f"Channel sumber: {source_name}\n\n"
            f"{hashtags}"
        )
    return (
        f"{plan.original_hook.strip()}\n\n"
        f"Video ini membahas {natural_title}. "
        f"{plan.new_angle.strip()} {plan.conclusion.strip()}"
        f"{context_block}\n\n"
        f"{plan.engagement_question.strip()}\n\n"
        f"Sumber video: {natural_title}\n"
        f"Link sumber: {source_url}\n"
        f"Channel sumber: {source_name}\n\n"
        f"{hashtags}"
    )
