import json
import re

import httpx

from app.core.config import get_settings

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
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return None
    if not _is_specific_title(title) or len(hook) < 20:
        return None
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
            return generated

    text = _clean_transcript(transcript)
    if content_type == "sports":
        title = _fallback_sports_title(text, source_title, rank)
        lowered = text.lower()
        if "history" in lowered:
            hook = (
                "Gol ini bukan sekadar menambah skor, tetapi mengubah kemenangan "
                "besar menjadi catatan bersejarah."
            )
        elif "second" in lowered:
            hook = (
                "Pertahanan belum pulih ketika serangan berikutnya kembali "
                "menghukum mereka dengan cara yang sama."
            )
        elif "goal" in lowered:
            hook = (
                "Beberapa detik sebelum bola masuk menunjukkan detail kecil "
                "yang membuat pertahanan kehilangan kendali."
            )
        else:
            hook = (
                "Perubahan kecil dalam rangkaian permainan ini menjadi awal "
                "dari kejadian yang menentukan."
            )
        return {"title": title, "hook": hook}
    if not text:
        return {
            "title": f"Gagasan yang Mengubah Cara Pandang di Bagian #{rank}",
            "hook": (
                "Bagian ini menyimpan sudut pandang yang baru terasa penting "
                "setelah konteks lengkapnya dipahami."
            ),
        }

    first_sentence = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
    words = first_sentence.strip(" .!?").split()
    excerpt = " ".join(words[:10])
    if len(words) > 10:
        excerpt += "..."
    return {
        "title": f"Kenapa {excerpt[:1].lower() + excerpt[1:]}"[:120],
        "hook": (
            "Pernyataan ini terdengar sederhana, tetapi konteks setelahnya "
            "mengubah makna dan dampaknya."
        ),
    }
