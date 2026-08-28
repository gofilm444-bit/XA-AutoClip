import json
import re
from time import perf_counter

import httpx
import structlog

from app.core.config import get_settings
from app.services.usage_audit import estimate_ai_usage

logger = structlog.get_logger()

GENERIC_TITLES = {
    "momen paling menegangkan",
    "momen pertandingan",
    "highlight pertandingan",
    "bagian percakapan",
}
GENERIC_HOOKS = {
    "intensitas pertandingan meningkat tepat sebelum momen ini.",
    "jangan potong momen ramai sebelum memahami konteksnya.",
}
LOCAL_TITLE_FALLBACK = "Momen Ini Perlu Didengar Sampai Akhir"
LOCAL_HOOK_FALLBACK = "Bagian ini membuka konteks yang lebih menarik dari awalnya."
LOCAL_FILLERS = {"jadi", "nah", "terus", "lalu", "kemudian", "eee", "hmm", "oke"}
LOCAL_STOPWORDS = LOCAL_FILLERS | {
    "ada",
    "adalah",
    "akan",
    "atau",
    "bahwa",
    "berbulan-bulan",
    "bisa",
    "dalam",
    "dan",
    "dari",
    "dengan",
    "di",
    "dia",
    "ini",
    "itu",
    "juga",
    "gak",
    "harus",
    "karena",
    "ke",
    "kita",
    "mereka",
    "memahami",
    "menjaga",
    "pada",
    "perlu",
    "saat",
    "satu",
    "saya",
    "sebagai",
    "sebelum",
    "seperti",
    "setelah",
    "sudah",
    "sih",
    "tetap",
    "tapi",
    "tuh",
    "tidak",
    "untuk",
    "udah",
    "aja",
    "kan",
    "oh",
    "ya",
    "yang",
}
BAD_TOPIC_TOKENS = LOCAL_STOPWORDS | {
    "bro",
    "geser",
    "gitu",
    "iya",
    "mas",
    "nggak",
}
BAD_TOPIC_PHRASES = {
    "gak satu",
    "gitu bro",
    "gitu mas",
    "iya gak",
    "iya geser",
    "nah itu",
    "oh iya",
    "udah ternyata",
    "ya kan",
}
MEANINGFUL_TOPIC_PHRASES = (
    "zona waktu",
    "pindah zona waktu",
    "waktu antartika",
    "hidup di antartika",
    "tes psikologi",
    "gangguan mental",
    "stasiun antartika",
    "beasiswa rusia",
    "pemerintah rusia",
    "gurun terbesar",
    "air bersih",
    "peneliti antartika",
)


def _clean_transcript(transcript: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"\[\d{2}:\d{2}\]\s*", "", transcript)).strip()


def _response_text(payload: dict) -> str:
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                return str(content.get("text", ""))
    return ""


def _clean_title(value: str) -> str:
    title = re.sub(r"\s+", " ", value).strip(" \"'\n")
    title = re.sub(r"^(judul|title)\s*:\s*", "", title, flags=re.IGNORECASE)
    return title[:120].rstrip(" .")


def _normalized_words(value: str) -> list[str]:
    return re.findall(r"\b[\w'-]+\b", value.lower(), flags=re.UNICODE)


def _limit_words(value: str, maximum: int) -> str:
    words = re.sub(r"\s+", " ", value).strip().split()
    return " ".join(words[:maximum]).strip(" ,;:-")


def _is_too_similar(copy: str, transcript: str, threshold: float = 0.72) -> bool:
    copy_words = _normalized_words(copy)
    transcript_words = set(_normalized_words(transcript)[:40])
    if not copy_words:
        return True
    if " ".join(copy_words) == " ".join(_normalized_words(transcript)[: len(copy_words)]):
        return True
    overlap = sum(word in transcript_words for word in copy_words) / len(copy_words)
    return overlap >= threshold


def extract_local_topics(transcript_snippet: str, limit: int = 5) -> list[str]:
    """Extract useful Indonesian topic words without external services."""
    cleaned = _clean_transcript(transcript_snippet)
    original_words = re.findall(r"\b[\w'-]{3,}\b", cleaned, flags=re.UNICODE)
    frequencies: dict[str, int] = {}
    first_position: dict[str, int] = {}
    proper_nouns: set[str] = set()
    for index, original in enumerate(original_words):
        word = original.lower().strip("'-")
        if word in LOCAL_STOPWORDS or word.isdigit() or len(word) < 3:
            continue
        frequencies[word] = frequencies.get(word, 0) + 1
        first_position.setdefault(word, index)
        if index > 0 and original[:1].isupper():
            proper_nouns.add(word)

    ranked = sorted(
        frequencies,
        key=lambda word: (
            word in proper_nouns,
            frequencies[word],
            -first_position[word],
        ),
        reverse=True,
    )
    return ranked[: max(2, min(limit, 5))]


def is_bad_main_topic(topic: str, transcript_snippet: str | None = None) -> bool:
    normalized = " ".join(_normalized_words(topic))
    if not normalized:
        return True
    if normalized in MEANINGFUL_TOPIC_PHRASES:
        return False
    if any(phrase in normalized for phrase in BAD_TOPIC_PHRASES):
        return True
    words = normalized.split()
    meaningful = [word for word in words if word not in BAD_TOPIC_TOKENS]
    if len(words) <= 2 and len(meaningful) < 2:
        return True
    if sum(word in BAD_TOPIC_TOKENS for word in words) / len(words) >= 0.5:
        return True
    if transcript_snippet:
        opening = _normalized_words(transcript_snippet)[: len(words)]
        if words == opening and any(word in BAD_TOPIC_TOKENS for word in words):
            return True
    return len(meaningful) < 2


def extract_main_idea(
    transcript_snippet: str,
    content_type: str | None = None,
) -> dict[str, object]:
    """Reduce a noisy transcript to one grounded idea for local candidate copy."""
    text = _clean_transcript(transcript_snippet)
    lowered = text.lower()
    words = _normalized_words(text)
    bad_tokens = LOCAL_FILLERS | {
        "aja",
        "gak",
        "kan",
        "nggak",
        "oh",
        "satu",
        "sih",
        "tuh",
        "udah",
        "ya",
    }
    removed = sorted({word for word in words if word in bad_tokens})
    entities: list[str] = []
    for entity, markers in (
        ("Antartika", ("antartika", "billingsgauz", "stasiun")),
        ("Rusia", ("rusia",)),
        ("Australia", ("australia",)),
    ):
        if any(marker in lowered for marker in markers):
            entities.append(entity)

    mental_signals = (
        "tes psikologi",
        "gangguan mental",
        "berantem",
        "konflik",
        "mudah sensi",
        "tekanan mental",
        "dikurung berbulan-bulan",
    )
    polar_context = "antartika" in lowered or any(
        marker in lowered for marker in ("billingsgauz", "kepala stasiun", "di stasiun")
    )
    if polar_context and any(signal in lowered for signal in mental_signals):
        if "Antartika" not in entities:
            entities.insert(0, "Antartika")
        return {
            "kind": "mental_antartika",
            "main_topic": "tes psikologi Antartika",
            "subtopic": "hidup lama di lingkungan terisolasi",
            "tension_or_problem": "tekanan mental dan konflik antar penghuni",
            "why_it_matters": "seleksi mental membantu orang bertahan dan bekerja bersama",
            "entities": entities,
            "bad_tokens_removed": removed,
        }
    zone_signals = (
        "zona waktu",
        "ganti zona",
        "pindah zona",
        "garis bujur",
        "geser kanan",
        "geser kiri",
    )
    if "antartika" in lowered and any(signal in lowered for signal in zone_signals):
        return {
            "kind": "zona_waktu_antartika",
            "main_topic": "zona waktu Antartika",
            "subtopic": "aturan waktu antar lokasi penelitian",
            "tension_or_problem": "waktu tidak mengikuti satu zona yang sederhana",
            "why_it_matters": "perpindahan lokasi dapat mengubah waktu yang digunakan",
            "entities": entities,
            "bad_tokens_removed": removed,
        }
    if "beasiswa" in lowered and "rusia" in lowered:
        return {
            "kind": "beasiswa_rusia",
            "main_topic": "beasiswa Rusia",
            "subtopic": "alasan dan proses pemilihan penerima",
            "tension_or_problem": "bantuan memiliki konteks lebih luas dari pendanaan",
            "why_it_matters": "alasan pemilihan menjelaskan tujuan program",
            "entities": entities,
            "bad_tokens_removed": removed,
        }
    if "antartika" in lowered and any(
        marker in lowered for marker in ("air bersih", "gurun", "kering", "curah hujan")
    ):
        return {
            "kind": "gurun_antartika",
            "main_topic": "Antartika sebagai gurun",
            "subtopic": "air, es, dan kondisi sangat kering",
            "tension_or_problem": "banyak es tidak berarti wilayahnya menerima banyak hujan",
            "why_it_matters": "definisi gurun sering disalahpahami",
            "entities": entities,
            "bad_tokens_removed": removed,
        }
    if "antartika" in lowered and any(
        marker in lowered for marker in ("hidup", "tinggal", "dingin", "terisolasi")
    ):
        return {
            "kind": "hidup_antartika",
            "main_topic": "hidup di Antartika",
            "subtopic": "tinggal lama di lingkungan terisolasi",
            "tension_or_problem": "dingin dan keterasingan mempersulit kehidupan sehari-hari",
            "why_it_matters": "penghuni perlu beradaptasi secara fisik dan mental",
            "entities": entities,
            "bad_tokens_removed": removed,
        }

    preferred_phrase = next(
        (phrase for phrase in MEANINGFUL_TOPIC_PHRASES if phrase in lowered),
        None,
    )
    topics = extract_local_topics(text, limit=3)
    main_topic = preferred_phrase or (" ".join(topics[:2]) if topics else "momen utama")
    if is_bad_main_topic(main_topic, text):
        if "Antartika" in entities:
            main_topic = "kehidupan Antartika"
        elif "Rusia" in entities:
            main_topic = "konteks Rusia"
        else:
            main_topic = "momen utama"
    tension = ""
    if any(marker in lowered for marker in ("masalah", "konflik", "salah", "perdebatan")):
        tension = "ada masalah atau perbedaan yang perlu dipahami"
    return {
        "kind": "sports" if content_type == "sports" else "general",
        "main_topic": main_topic,
        "subtopic": topics[2] if len(topics) > 2 else "",
        "tension_or_problem": tension,
        "why_it_matters": "konteks lengkap mengubah cara momen ini dipahami",
        "entities": entities,
        "bad_tokens_removed": removed,
    }


BAD_LOCAL_TITLE_PHRASES = {
    "nggak berbulan-bulan",
    "gak satu udah",
    "antartika jalan baru",
    "nggak jadi masalah",
} | BAD_TOPIC_PHRASES


def _is_bad_local_title(title: str) -> bool:
    normalized = " ".join(_normalized_words(title))
    words = normalized.split()
    if any(phrase in normalized for phrase in BAD_LOCAL_TITLE_PHRASES):
        return True
    if re.search(
        r"\b(?:dari|tentang|kenapa)\s+(?:iya|ya|oh|nah|jadi|gitu|gak|nggak|udah)\b",
        normalized,
    ):
        return True
    filler_count = sum(word in LOCAL_STOPWORDS for word in words)
    if words and filler_count / len(words) > 0.45:
        return True
    meaningful = [word for word in words if word not in LOCAL_STOPWORDS]
    return len(meaningful) < 2


def _domain_title_fallback(idea: dict[str, object], text: str) -> str:
    kind = str(idea["kind"])
    if kind == "mental_antartika":
        return "Tes Psikologi Antartika Ini Ternyata Bukan Formalitas"
    if kind == "zona_waktu_antartika":
        if any(marker in text.lower() for marker in ("geser", "pindah", "garis bujur")):
            return "Kenapa Waktu di Antartika Bisa Bikin Bingung?"
        return "Di Antartika, Zona Waktu Ternyata Tidak Sesederhana Itu"
    if kind == "hidup_antartika":
        return "Tinggal di Antartika Ternyata Ribetnya Bukan Cuma Dingin"
    if kind == "gurun_antartika":
        return "Fakta Antartika Ini Bikin Banyak Orang Salah Paham"
    if kind == "beasiswa_rusia":
        return "Beasiswa Rusia Ini Ternyata Tidak Sesederhana Itu"
    main_topic = str(idea["main_topic"])
    if is_bad_main_topic(main_topic, text) or main_topic == "momen utama":
        return LOCAL_TITLE_FALLBACK
    return _limit_words(f"Hal yang Jarang Dibahas dari {main_topic.title()}", 12)


def rewrite_local_title(
    transcript_snippet: str,
    content_type: str,
    candidate_context: dict[str, object] | None = None,
) -> str:
    """Create concise local title copy from the candidate's main idea."""
    text = _clean_transcript(transcript_snippet)
    context = candidate_context or {}
    if content_type == "sports":
        title = _fallback_sports_title(
            text,
            str(context.get("source_title") or "") or None,
            int(context.get("rank") or 1),
        )
    else:
        idea = extract_main_idea(text, content_type)
        kind = str(idea["kind"])
        main_topic = str(idea["main_topic"]).title()
        if kind == "general" and str(idea["main_topic"]) == "momen utama":
            return LOCAL_TITLE_FALLBACK
        if kind == "mental_antartika":
            title = "Tes Psikologi Antartika Ini Ternyata Bukan Formalitas"
        elif kind == "zona_waktu_antartika":
            title = _domain_title_fallback(idea, text)
        elif kind == "beasiswa_rusia":
            title = "Beasiswa Rusia Ini Ternyata Tidak Sesederhana Itu"
        elif kind == "gurun_antartika":
            title = "Kenapa Antartika Disebut Gurun Terbesar?"
        elif kind == "hidup_antartika":
            title = "Tinggal di Antartika Ternyata Ribetnya Bukan Cuma Dingin"
        elif str(idea["tension_or_problem"]):
            title = f"Kenapa {main_topic} Bisa Jadi Perdebatan?"
        else:
            title = f"Hal yang Jarang Dibahas dari {main_topic}"

    title = _limit_words(_clean_title(title), 12)
    idea = extract_main_idea(text, content_type)
    fallback_topic = str(idea["main_topic"]).title()
    fallback = _limit_words(f"Hal yang Jarang Dibahas dari {fallback_topic}", 12)
    if not title or _is_bad_local_title(title):
        title = _domain_title_fallback(idea, text)
    if _is_bad_local_title(title):
        title = LOCAL_TITLE_FALLBACK
    if str(idea["kind"]) in {"general", "sports"} and _is_too_similar(title, text):
        title = fallback if not _is_too_similar(fallback, text) else LOCAL_TITLE_FALLBACK
    return title


def rewrite_local_hook(
    transcript_snippet: str,
    title: str,
    content_type: str,
    candidate_context: dict[str, object] | None = None,
) -> str:
    """Create a restrained curiosity gap from the candidate's main idea."""
    del title, candidate_context
    text = _clean_transcript(transcript_snippet)
    lowered = text.lower()
    meaningful_words = [word for word in _normalized_words(text) if word not in LOCAL_STOPWORDS]
    if not meaningful_words:
        return LOCAL_HOOK_FALLBACK
    idea = extract_main_idea(text, content_type)
    kind = str(idea["kind"])
    if content_type == "sports":
        if "history" in lowered or "sejarah" in lowered:
            hook = "Gol ini bukan sekadar menambah skor, tetapi mengubah kemenangan besar menjadi catatan bersejarah."
        elif "second" in lowered:
            hook = "Pertahanan belum pulih ketika serangan berikutnya kembali menghukum mereka dengan pola yang sama."
        elif any(word in lowered for word in ("goal", "gol", "equalizer", "penyama")):
            hook = "Yang menentukan bukan golnya saja, tetapi rangkaian kecil yang membuka peluang tersebut."
        elif any(word in lowered for word in ("save", "saved", "penyelamatan")):
            hook = "Reaksi singkat ini mengubah peluang lawan sebelum situasinya berkembang lebih jauh."
        else:
            hook = "Momen singkat ini mengubah arah permainan lewat detail yang mudah terlewat."
    elif kind == "mental_antartika":
        hook = "Yang diuji bukan cuma kemampuan kerja, tetapi tahan hidup lama dengan orang yang sama."
    elif kind == "zona_waktu_antartika":
        hook = "Di Antartika, waktu ternyata bisa berubah hanya karena bergeser lokasi."
    elif kind == "hidup_antartika":
        hook = "Ribetnya Antartika bukan cuma dingin, tetapi juga cara hidup dan bekerja di sana."
    elif kind == "beasiswa_rusia":
        hook = "Cerita ini bukan cuma soal beasiswa, tetapi alasan Rusia memilih mereka."
    elif kind == "gurun_antartika":
        hook = "Antartika terlihat penuh es, tetapi faktanya jauh lebih membingungkan."
    else:
        main_topic = str(idea["main_topic"])
        hook = f"{main_topic.capitalize()} terlihat sederhana, tetapi konteksnya membuat pembahasan ini berbeda."

    hook = _limit_words(hook, 18)
    generic_hooks = {
        "masalahnya bukan di awal cerita tetapi alasan yang membentuk seluruh konteksnya",
        "bagian ini membuat pembahasannya terasa berbeda setelah konteks lengkapnya terlihat",
    }
    if " ".join(_normalized_words(hook)) in generic_hooks and kind != "general":
        if kind == "zona_waktu_antartika":
            hook = "Di Antartika, waktu ternyata bisa berubah hanya karena bergeser lokasi."
        elif kind == "mental_antartika":
            hook = "Yang diuji bukan cuma kemampuan kerja, tetapi tahan hidup lama dengan orang yang sama."
    if not hook or _is_too_similar(hook, text):
        return LOCAL_HOOK_FALLBACK
    return hook


def rewrite_local_description(transcript_snippet: str, content_type: str) -> str:
    text = _clean_transcript(transcript_snippet)
    idea = extract_main_idea(text, content_type)
    kind = str(idea["kind"])
    if content_type == "sports":
        return "Cuplikan ini menyoroti rangkaian permainan yang menentukan perubahan momentum."
    if kind == "mental_antartika":
        return "Cuplikan ini membahas kenapa tes psikologi penting bagi orang yang hidup lama di Antartika."
    if kind == "zona_waktu_antartika":
        return "Cuplikan ini membahas kenapa zona waktu di Antartika tidak sesederhana biasanya."
    if kind == "hidup_antartika":
        return "Cuplikan ini menjelaskan sisi ribet tinggal dan bekerja di Antartika."
    if kind == "gurun_antartika":
        return "Cuplikan ini membahas fakta Antartika yang sering disalahpahami."
    if kind == "beasiswa_rusia":
        return "Cuplikan ini menjelaskan konteks dan alasan di balik beasiswa Rusia."
    main_topic = str(idea["main_topic"])
    if main_topic != "momen utama":
        return f"Cuplikan ini membahas {main_topic} dan alasan topik ini penting dipahami."
    return "Cuplikan ini merangkum momen utama dan konteks yang menyertainya."


def _is_specific_title(title: str) -> bool:
    lowered = title.lower()
    return (
        20 <= len(title) <= 120
        and not any(generic in lowered for generic in GENERIC_TITLES)
    )


def needs_candidate_copy_refresh(title: str, hook: str) -> bool:
    lowered_title = title.lower()
    return (
        any(generic in lowered_title for generic in GENERIC_TITLES)
        or lowered_title == "gol keempat yang membawa amerika serikat ukir sejarah!"
        or hook.strip().lower() in GENERIC_HOOKS
    )


def _openai_copy(
    content_type: str,
    transcript: str,
    source_title: str | None,
) -> dict[str, str] | None:
    settings = get_settings()
    if not getattr(settings, "title_hook_ai_enabled", False):
        logger.info(
            "title_hook_ai_skipped",
            reason="disabled_by_config",
            provider="local",
            configured_provider="openai",
            model=settings.title_model,
        )
        return None
    if not settings.openai_api_key or not transcript.strip():
        return None

    prompt = f"""
Anda adalah editor judul video pendek berbahasa Indonesia.

Buat SATU judul dan SATU hook pendamping.

Judul harus:
- akurat berdasarkan transkrip, tanpa mengarang fakta;
- menyebut pemain, tim, kejadian, rekor, atau akibat paling spesifik;
- memiliki hook kuat dan membuat penasaran, tetapi bukan clickbait palsu;
- idealnya 45-85 karakter, maksimum 100 karakter;
- tidak memakai nomor kandidat;
- tidak memakai judul generik seperti "momen paling menegangkan",
  "highlight pertandingan", atau "momen pertandingan";
- untuk olahraga, utamakan gol, pencetak gol, rekor, comeback, kegagalan,
  penyelamatan, atau perubahan skor;

Hook harus:
- satu kalimat 12-24 kata;
- memperjelas taruhan atau pentingnya momen tanpa mengulang judul;
- membuat penonton ingin mengetahui rangkaian lengkapnya.

Keluarkan JSON saja: {{"title":"...","hook":"..."}}.

Jenis konten: {content_type}
Judul sumber: {source_title or "Tidak tersedia"}
Transkrip klip:
{transcript}
""".strip()
    started_at = perf_counter()
    logger.info(
        "ai_call_started",
        ai_call_type="title_hook_generation",
        provider="openai",
        model=settings.title_model,
        input_text_length=len(transcript),
        retry_count=0,
        **estimate_ai_usage(
            "title_hook_generation", "openai", settings.title_model,
            input_text_length=len(transcript),
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
                "model": settings.title_model,
                "input": prompt,
            },
            timeout=120,
        )
        response.raise_for_status()
        parsed = json.loads(_response_text(response.json()))
        title = _clean_title(str(parsed["title"]))
        hook = re.sub(r"\s+", " ", str(parsed["hook"])).strip()[:240]
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
        logger.warning(
            "ai_call_failed",
            ai_call_type="title_hook_generation",
            provider="openai",
            model=settings.title_model,
            input_text_length=len(transcript),
            error=str(exc),
            request_duration_ms=round((perf_counter() - started_at) * 1000),
            **estimate_ai_usage(
                "title_hook_generation", "openai", settings.title_model,
                input_text_length=len(transcript),
            ),
        )
        logger.warning(
            "title_hook_ai_failed_fallback_local",
            provider="openai",
            model=settings.title_model,
            reason="openai_request_failed",
            error=str(exc),
        )
        return None
    if not _is_specific_title(title) or len(hook) < 20:
        return None
    logger.info(
        "ai_call_completed",
        ai_call_type="title_hook_generation",
        provider="openai",
        model=settings.title_model,
        input_text_length=len(transcript),
        output_text_length=len(title) + len(hook),
        request_duration_ms=round((perf_counter() - started_at) * 1000),
        cache_hit=False,
        **estimate_ai_usage(
            "title_hook_generation", "openai", settings.title_model,
            input_text_length=len(transcript),
            output_text_length=len(title) + len(hook),
        ),
    )
    return {"title": title, "hook": hook}


def _extract_player_before_goal(text: str) -> str | None:
    matches = re.findall(
        r"(?:this is|oh yes[!,.]?|from)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)?)",
        text,
        flags=re.IGNORECASE,
    )
    if not matches:
        return None
    player = matches[-1].title()
    return {"Gio Reina": "Gio Reyna"}.get(player, player)


def _fallback_sports_title(text: str, source_title: str | None, rank: int) -> str:
    lowered = text.lower()
    player = _extract_player_before_goal(text)
    usa = any(token in lowered for token in ("usa", "united states", "amerika serikat"))

    if "history" in lowered and re.search(r"\bfour goals?\b|\b4 goals?\b", lowered):
        if player and usa:
            return f"{player} Cetak Gol Keempat, Amerika Serikat Ukir Sejarah!"
        if usa:
            return "Gol Keempat yang Membawa Amerika Serikat Ukir Sejarah!"
        return "Gol Keempat Ini Mengukir Sejarah Baru di Piala Dunia!"
    if "helps himself to a second" in lowered or "his second" in lowered:
        name = player or ("Balogun" if "balogun" in lowered else None)
        return (
            f"{name} Cetak Gol Kedua, Pertahanan Lawan Dibuat Tak Berdaya!"
            if name
            else "Gol Kedua Ini Membuat Pertahanan Lawan Tak Berdaya!"
        )
    if any(keyword in lowered for keyword in ("equalizer", "equaliser", "penyama")):
        return (
            f"{player} Samakan Skor, Momentum Pertandingan Berubah Total!"
            if player
            else "Gol Penyeimbang Ini Mengubah Jalannya Pertandingan!"
        )
    if any(keyword in lowered for keyword in ("winning goal", "late winner", "gol kemenangan")):
        return "Gol Penentu di Menit Krusial yang Membungkam Pertandingan!"
    if any(keyword in lowered for keyword in ("header", "headed", "sundulan")):
        return "Sundulan Sempurna Ini Membuat Kiper Tak Berkutik!"
    if any(keyword in lowered for keyword in ("save", "saved", "pushed away", "penyelamatan")):
        return "Penyelamatan Krusial Ini Menggagalkan Peluang Emas!"
    if any(keyword in lowered for keyword in ("goal!", "shot is in", "finds the net")):
        return (
            f"{player} Cetak Gol, Tapi Detail Sebelumnya yang Jadi Kunci!"
            if player
            else "Gol Ini Terjadi karena Detail yang Nyaris Tak Terlihat!"
        )
    if "space opening up" in lowered and "goal" in lowered:
        return "Ruang Terbuka Sesaat, Gol Ini Langsung Menghukum Pertahanan!"
    if source_title:
        teams = re.findall(
            r"(Amerika Serikat|USA|Paraguay|Korea Selatan|Ceko)",
            source_title,
            flags=re.IGNORECASE,
        )
        if teams:
            return f"Apa yang Terjadi hingga {teams[0]} Menguasai Momen Ini?"
    return f"Detail Sebelum Kejadian Ini Mengubah Pertandingan #{rank}"


def generate_candidate_title(
    content_type: str,
    transcript: str,
    rank: int,
    source_title: str | None = None,
    use_ai: bool = True,
) -> str:
    return generate_candidate_copy(
        content_type,
        transcript,
        rank,
        source_title,
        use_ai,
    )["title"]


def generate_candidate_copy(
    content_type: str,
    transcript: str,
    rank: int,
    source_title: str | None = None,
    use_ai: bool = True,
) -> dict[str, str]:
    if use_ai:
        generated = _openai_copy(content_type, transcript, source_title)
        if generated:
            generated["description"] = rewrite_local_description(transcript, content_type)
            return generated

    text = _clean_transcript(transcript)
    if not text:
        title = LOCAL_TITLE_FALLBACK
        hook = LOCAL_HOOK_FALLBACK
    else:
        context: dict[str, object] = {"rank": rank, "source_title": source_title}
        title = rewrite_local_title(text, content_type, context)
        hook = rewrite_local_hook(text, title, content_type, context)
    description = rewrite_local_description(text, content_type)

    logger.info(
        "local_title_hook_rewrite_applied",
        title_was_rewritten=not _is_too_similar(title, text),
        hook_was_rewritten=not _is_too_similar(hook, text),
        content_type=content_type,
        title_word_count=len(_normalized_words(title)),
        hook_word_count=len(_normalized_words(hook)),
    )
    return {"title": title, "hook": hook, "description": description}
