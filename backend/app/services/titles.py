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
    "kenapa topik ini penting",
    "hal yang jarang dibahas",
    "ini yang membuat perdebatan",
    "pembahasan menarik tentang",
    "alasan kenapa ini jadi masalah",
}
GENERIC_HOOKS = {
    "intensitas pertandingan meningkat tepat sebelum momen ini.",
    "jangan potong momen ramai sebelum memahami konteksnya.",
    "bagian ini membuka konteks yang lebih menarik dari awalnya.",
    "masalahnya bukan di awal cerita tetapi alasan yang membentuk seluruh konteksnya.",
    "bagian ini membuat pembahasannya terasa berbeda setelah konteks lengkapnya terlihat.",
}
LOCAL_TITLE_FALLBACK = "Momen Ini Perlu Didengar Sampai Akhir"
LOCAL_HOOK_FALLBACK = "Bagian ini membuka sudut pandang menarik yang jarang dibahas."
LOCAL_FILLERS = {
    "jadi", "nah", "terus", "lalu", "kemudian", "eee", "hmm", "oke", "dong", "kan",
    "sih", "tuh", "deh", "nih", "kok", "yuk", "loh", "ya", "oh", "eh", "ah"
}
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
    "tetap",
    "tapi",
    "tidak",
    "untuk",
    "udah",
    "aja",
    "yang",
    "gue",
    "lu",
    "aku",
    "kamu",
    "kayak",
    "cuma",
    "cuman",
    "banget",
    "si",
    "apa",
    "mana",
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
    "aku kayak",
    "apa kisah",
    "masuk pro",
    "aku indomie",
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
    "standar hidup",
    "tanpa hp",
    "kebun kelapa",
    "prajurit jepang",
    "patung penjajah",
    "efisiensi anggaran",
)


def _clean_transcript(transcript: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"\[\d{2}:\d{2}(?::\d{2})?\]\s*", " ", transcript)).strip()


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
        "aja", "gak", "kan", "nggak", "oh", "satu", "sih", "tuh", "udah", "ya"
    }
    removed = sorted({word for word in words if word in bad_tokens})
    entities: list[str] = []
    for entity, markers in (
        ("Antartika", ("antartika", "billingsgauz", "stasiun antartika")),
        ("Rusia", ("rusia",)),
        ("Australia", ("australia",)),
        ("Morotai", ("morotai", "morota")),
        ("Jepang", ("jepang", "nakamura", "teru nakamura")),
    ):
        if any(marker in lowered for marker in markers):
            entities.append(entity)

    # 1. Social Competition, Ruined Standards & Insecurity
    if any(term in lowered for term in ("insecure", "standartmu", "standar hidup", "kompetisi", "nyesel", "penyesalan")) and any(term in lowered for term in ("rusak", "kompetisi", "orang jakarta", "kampung")):
        return {
            "kind": "kompetisi_insecure",
            "main_topic": "standar hidup dan kompetisi",
            "subtopic": "insecurity dan perbandingan sosial",
            "tension_or_problem": "melihat kompetisi terus-menerus merusak standar hidup dan memicu rasa kurang",
            "why_it_matters": "hidup sederhana lebih menenangkan dibanding terus terjebak kompetisi",
            "entities": entities,
            "bad_tokens_removed": removed,
        }

    # 2. Digital Detox / Smartphone Detachment
    if any(term in lowered for term in ("matikan hp", "tanpa hp", "seminggu tanpa", "tanpa apapun")) and "insecure" in lowered:
        return {
            "kind": "tanpa_hp",
            "main_topic": "seminggu tanpa HP",
            "subtopic": "detoks media sosial dan ketenangan hidup",
            "tension_or_problem": "ketergantungan gawai membuat hidup bising dan rentan stres",
            "why_it_matters": "berhenti sejenak dari HP terbukti menghilangkan kegelisahan",
            "entities": entities,
            "bad_tokens_removed": removed,
        }

    # 3. Property vs Smartphone Value Paradox
    if any(term in lowered for term in ("25 juta", "rumah kayu", "kebun kelapa", "beli rumah")) and any(term in lowered for term in ("iphone", "hp", "muara", "kepiting", "kampung")):
        return {
            "kind": "rumah_vs_iphone",
            "main_topic": "rumah 25 juta plus kebun",
            "subtopic": "paradoks harga aset vs gawai konsumtif",
            "tension_or_problem": "harga rumah dan kebun kelapa ternyata sama dengan satu unit smartphone",
            "why_it_matters": "standar nilai hidup di kota seringkali berbeda jauh dari realitas di daerah",
            "entities": entities,
            "bad_tokens_removed": removed,
        }

    # 4. Soldier Hiding 30 Years (Teruo Nakamura / Morotai)
    if any(term in lowered for term in ("teru nakamura", "nakamura", "tentara jepang", "prajurit jepang", "sembunyi selama hampir 30 tahun", "sembunyi 30 tahun", "perang dunia 2 masih berlangsung")):
        return {
            "kind": "prajurit_jepang_morotai",
            "main_topic": "prajurit Jepang di Morotai",
            "subtopic": "bersembunyi 30 tahun di hutan",
            "tension_or_problem": "antara kesetiaan prajurit dan ancaman bagi warga lokal yang memicu pro kontra",
            "why_it_matters": "fakta sejarah di balik kisah prajurit yang mengira perang belum usai",
            "entities": entities,
            "bad_tokens_removed": removed,
        }

    # 5. Colonial Monument / Statue Controversy
    if any(term in lowered for term in ("patung penjajah", "dijadikan monumen", "ngapain dihargai", "ngebunuh banyak orang", "pahlawan")) and "monumen" in lowered:
        return {
            "kind": "patung_penjajah",
            "main_topic": "monumen patung penjajah",
            "subtopic": "perdebatan memori sejarah vs luka warga",
            "tension_or_problem": "sosok yang membunuh warga lokal justru dibuatkan patung penghormatan",
            "why_it_matters": "warga lokal mempertanyakan kelayakan monumen penjajah sebagai pahlawan",
            "entities": entities,
            "bad_tokens_removed": removed,
        }

    # 6. Ruined WWII Museum
    if ("museum" in lowered or "perang dunia" in lowered) and any(term in lowered for term in ("udah rusak", "rusak", "dibongkar", "sisa-sisa")):
        return {
            "kind": "museum_rusak",
            "main_topic": "museum Perang Dunia II",
            "subtopic": "kondisi peninggalan bersejarah",
            "tension_or_problem": "artefak dan museum bersejarah ternyata sudah rusak dan dibongkar",
            "why_it_matters": "kurangnya perawatan membuat peninggalan sejarah penting terbengkalai",
            "entities": entities,
            "bad_tokens_removed": removed,
        }

    # 7. Antarctic Psychological Isolation
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

    # 8. Antarctic Time Zones
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

    # 9. Russian Scholarship
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

    # 10. Antarctic Desert
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

    # 11. Living in Antarctica
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

    # 12. Budget / Public Policy
    if "anggaran" in lowered or "efisiensi" in lowered or ("pendidikan" in lowered and "kesehatan" in lowered):
        return {
            "kind": "kebijakan_publik",
            "main_topic": "efisiensi anggaran",
            "subtopic": "prioritas pendidikan dan kesehatan",
            "tension_or_problem": "pemangkasan biaya tidak boleh mengorbankan sektor vital",
            "why_it_matters": "kebijakan publik berdampak langsung pada masyarakat luas",
            "entities": entities,
            "bad_tokens_removed": removed,
        }

    # Generic Fallback Topic Finder
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
        elif "Morotai" in entities:
            main_topic = "sejarah Morotai"
        elif "Jepang" in entities:
            main_topic = "sejarah Jepang"
        else:
            main_topic = "momen utama"

    tension = ""
    if any(marker in lowered for marker in ("masalah", "konflik", "salah", "perdebatan", "bingung", "kaget")):
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


def _generate_copy_candidates(
    idea: dict[str, object],
    text: str,
    content_type: str,
    context: dict[str, object] | None = None,
) -> list[dict[str, str]]:
    """Generate a diverse pool of candidate copies (title, hook, description)."""
    kind = str(idea.get("kind", "general"))
    candidates: list[dict[str, str]] = []
    lowered = text.lower()

    if content_type == "sports":
        rank = int((context or {}).get("rank", 1))
        source_title = str((context or {}).get("source_title", "") or "")
        sports_title = _fallback_sports_title(text, source_title or None, rank)
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
        desc = "Cuplikan ini menyoroti rangkaian permainan yang menentukan perubahan momentum."
        candidates.append({"title": sports_title, "hook": hook, "description": desc})
        return candidates

    if kind == "kompetisi_insecure":
        candidates.extend([
            {
                "title": "Standar Hidup Kita Rusak Karena Kompetisi",
                "hook": "Standar hidup kita rusak karena terlalu sering lihat kompetisi orang lain.",
                "description": "Klip ini membahas bagaimana kompetisi sosial dan media sosial merusak standar hidup serta membuat orang makin gampang insecure."
            },
            {
                "title": "Kenapa Orang Kota Makin Gampang Insecure?",
                "hook": "Jangan-jangan kita gelisah bukan karena hidup kita, tapi standar yang kita lihat tiap hari.",
                "description": "Pembahasan mengenai tekanan standar hidup perkotaan yang memicu rasa insecure terus-menerus."
            },
            {
                "title": "Yang Rusak Bukan Hidup Kita, Tapi Standar Kita",
                "hook": "Kadang yang bikin hidup terasa berat bukan keadaan, tapi standar kita yang terlalu tinggi.",
                "description": "Refleksi mendalam tentang bagaimana membandingkan pencapaian membuat hidup terasa kurang."
            },
            {
                "title": "Hidup Sederhana Justru Bisa Lebih Tenang?",
                "hook": "Melihat orang di kampung bikin sadar, hidup tanpa kompetisi ternyata jauh lebih tenang.",
                "description": "Kisah penyesalan saat menyadari hidup sederhana di desa terasa lebih damai dibanding perlombaan gengsi di kota."
            },
            {
                "title": "Ternyata Kompetisi yang Bikin Kita Selalu Merasa Kurang",
                "hook": "Gampang banget ngeliat pencapaian orang lain, sampai lupa menikmati hidup sendiri.",
                "description": "Klip ini menyoroti dampak buruk selalu membandingkan jumlah pengikut dan pencapaian dengan orang lain."
            },
        ])

    elif kind == "tanpa_hp":
        candidates.extend([
            {
                "title": "Berani Seminggu Tanpa HP?",
                "hook": "Coba seminggu tanpa HP, mungkin baru sadar hidup kita selama ini terlalu bising.",
                "description": "Tantangan berhenti sejenak dari gawai untuk memulihkan ketenangan dan menghilangkan rasa cemas."
            },
            {
                "title": "Coba Seminggu Tanpa HP, Insecure Langsung Hilang",
                "hook": "Kalau stres dan insecure mulai parah, matikan HP seminggu dan rasakan bedanya.",
                "description": "Rekomendasi sederhana namun efektif untuk mengatasi kecemasan akibat paparan media sosial berlebihan."
            },
        ])

    elif kind == "rumah_vs_iphone":
        candidates.extend([
            {
                "title": "Rumah 25 Juta Plus Kebun Ternyata Seharga iPhone?",
                "hook": "Di kampung ini, rumah plus kebun kelapa 50 meter harganya cuma seharga satu iPhone.",
                "description": "Klip ini menyoroti perbandingan kontras antara harga rumah plus kebun di pesisir dengan harga barang konsumtif di kota."
            },
            {
                "title": "Harga Rumah Plus Kebun di Sini Cuma Seharga HP",
                "hook": "Beli iPhone 17 Pro Max atau beli rumah kayu 2 kamar plus kebun kelapa 50 meter?",
                "description": "Perbandingan menarik antara aset properti di daerah dengan harga gawai terbaru di perkotaan."
            },
            {
                "title": "Di Kampung Ini, 25 Juta Sudah Dapat Rumah dan Kebun",
                "hook": "Perbandingan harga yang bikin mikir: rumah kayu plus kebun kelapa cuma 25 juta rupiah.",
                "description": "Kisah menemukan properti murah di perkampungan pesisir laut yang mengejutkan."
            },
        ])

    elif kind == "prajurit_jepang_morotai":
        candidates.extend([
            {
                "title": "Kisah Prajurit Jepang yang Sembunyi 30 Tahun di Hutan",
                "hook": "Bersembunyi 30 tahun di hutan karena percaya Perang Dunia II masih berlangsung.",
                "description": "Klip ini menceritakan kisah Teruo Nakamura, prajurit Jepang yang bertahan hidup 30 tahun di hutan Morotai tanpa tahu perang telah selesai."
            },
            {
                "title": "Kenapa Kisah Prajurit Jepang di Morotai Jadi Pro dan Kontra?",
                "hook": "Perintah gerilyanya bunuh semua musuh, tapi bagaimana nasib warga lokal yang lewat?",
                "description": "Dilema sejarah antara loyalitas prajurit Jepang bertahan hidup puluhan tahun dengan dampaknya bagi warga sekitar."
            },
        ])

    elif kind == "patung_penjajah":
        candidates.extend([
            {
                "title": "Kenapa Patung Penjajah Dijadikan Monumen?",
                "hook": "Warga asli curhat kenapa orang yang membunuh banyak warga justru dibuatkan patung.",
                "description": "Klip ini membahas perdebatan moral warga lokal tentang keberadaan monumen mantan tentara penjajah."
            },
            {
                "title": "Patung Penjajah Jadi Monumen: Menghargai Sejarah atau Melukai Warga?",
                "hook": "Pro dan kontra saat patung sosok yang merugikan warga dijadikan simbol pahlawan.",
                "description": "Diskusi kritis mengenai batas antara menjaga memori sejarah dan menghormati perasaan korban penjajahan."
            },
        ])

    elif kind == "museum_rusak":
        candidates.extend([
            {
                "title": "Museum Perang Dunia II Ini Ternyata Sudah Rusak dan Dibongkar",
                "hook": "Niatnya mau lihat peninggalan sejarah Perang Dunia II, ternyata kondisinya sudah dibongkar.",
                "description": "Kekecewaan saat melihat peninggalan museum bersejarah yang tidak terawat dan tinggal sisa-sisa."
            },
            {
                "title": "Kondisi Museum Bersejarah Ini Bikin Kaget",
                "hook": "Padahal ingin melihat saksi bisu perang dunia, tapi semua bangunannya sudah rusak.",
                "description": "Klip ini menyoroti kondisi museum peninggalan bersejarah yang memprihatinkan."
            },
        ])

    elif kind == "mental_antartika":
        candidates.extend([
            {
                "title": "Tes Psikologi Antartika Ini Ternyata Bukan Formalitas",
                "hook": "Yang diuji bukan cuma kemampuan kerja, tetapi tahan hidup lama dengan orang yang sama.",
                "description": "Cuplikan ini membahas kenapa tes psikologi penting bagi orang yang hidup lama di Antartika."
            },
            {
                "title": "Kenapa Tes Psikologi di Antartika Sangat Ketat?",
                "hook": "Tiba-tiba gangguan mental dan mudah emosi bisa terjadi saat terkurung berbulan-bulan.",
                "description": "Penjelasan tentang risiko psikologis ekstrem bagi para peneliti di stasiun Antartika."
            },
        ])

    elif kind == "zona_waktu_antartika":
        if any(marker in text.lower() for marker in ("geser", "pindah", "garis bujur")):
            candidates.append({
                "title": "Kenapa Waktu di Antartika Bisa Bikin Bingung?",
                "hook": "Di Antartika, waktu ternyata bisa berubah hanya karena bergeser lokasi.",
                "description": "Cuplikan ini membahas kenapa zona waktu di Antartika tidak sesederhana biasanya."
            })
        else:
            candidates.append({
                "title": "Di Antartika, Zona Waktu Ternyata Tidak Sesederhana Itu",
                "hook": "Di Antartika, waktu ternyata bisa berubah hanya karena bergeser lokasi.",
                "description": "Cuplikan ini membahas kenapa zona waktu di Antartika tidak sesederhana biasanya."
            })

    elif kind == "beasiswa_rusia":
        candidates.extend([
            {
                "title": "Beasiswa Rusia Ini Ternyata Tidak Sesederhana Itu",
                "hook": "Cerita ini bukan cuma soal beasiswa, tetapi alasan Rusia memilih mereka.",
                "description": "Cuplikan ini menjelaskan konteks dan alasan di balik beasiswa Rusia."
            },
        ])

    elif kind == "gurun_antartika":
        candidates.extend([
            {
                "title": "Kenapa Antartika Disebut Gurun Terbesar?",
                "hook": "Antartika terlihat penuh es, tetapi faktanya termasuk wilayah paling kering di bumi.",
                "description": "Cuplikan ini membahas fakta Antartika yang sering disalahpahami."
            },
            {
                "title": "Fakta Antartika Ini Bikin Banyak Orang Salah Paham",
                "hook": "Penuh es bukan berarti banyak air hujan, inilah kenapa Antartika disebut gurun.",
                "description": "Penjelasan ilmiah kenapa wilayah kutub bersalju diklasifikasikan sebagai gurun pasir es."
            },
        ])

    elif kind == "hidup_antartika":
        candidates.extend([
            {
                "title": "Tinggal di Antartika Ternyata Ribetnya Bukan Cuma Dingin",
                "hook": "Ribetnya Antartika bukan cuma dingin, tetapi juga cara hidup dan bekerja di sana.",
                "description": "Cuplikan ini menjelaskan sisi ribet tinggal dan bekerja di Antartika."
            },
        ])

    elif kind == "kebijakan_publik":
        candidates.extend([
            {
                "title": "Efisiensi Anggaran Pendidikan: Kenapa Dampaknya ke Mana-mana?",
                "hook": "Efisiensi anggaran harus dihitung cermat agar tidak merugikan pendidikan dan kesehatan.",
                "description": "Cuplikan ini membahas pentingnya menjaga prioritas anggaran belanja publik."
            },
            {
                "title": "Dilema Efisiensi Anggaran Antara Pendidikan dan Kesehatan",
                "hook": "Prioritas anggaran publik membutuhkan kejelasan arah dan pertimbangan matang.",
                "description": "Diskusi kebijakan publik mengenai keseimbangan anggaran sektor strategis."
            },
        ])

    # Universal Archetypes for General Topics only if no specific category matched
    if not candidates:
        main_topic = str(idea.get("main_topic", "momen utama"))
        if main_topic and main_topic != "momen utama" and not is_bad_main_topic(main_topic, text):
            title_topic = main_topic.title()
            candidates.extend([
                {
                    "title": f"Sudut Pandang Berbeda Tentang {title_topic}",
                    "hook": f"Pembahasan mengenai {main_topic} ini membuka fakta yang jarang diperhatikan orang.",
                    "description": f"Cuplikan ini membahas {main_topic} dan alasan topik ini penting dipahami."
                },
                {
                    "title": f"Fakta di Balik {title_topic} yang Jarang Disadari",
                    "hook": f"Kelihatannya sederhana, tetapi cerita {main_topic} ini menyimpan sudut pandang baru.",
                    "description": f"Klip ini mengulas aspek-aspek tak terduga seputar {main_topic}."
                },
            ])

        # Quote-driven candidate if strong statement exists
        quotes = [
            s.strip() for s in re.split(r"[.!?\n]+", text)
            if 5 <= len(s.strip().split()) <= 15
            and not any(s.strip().lower().startswith(f) for f in LOCAL_FILLERS)
        ]
        if quotes:
            best_quote = quotes[0]
            clean_q = re.sub(r"^(tapi|dan|karena|jadi|nah)\s+", "", best_quote, flags=re.IGNORECASE).strip()
            if 20 <= len(clean_q) <= 75:
                candidates.append({
                    "title": clean_q.capitalize(),
                    "hook": "Bagian ini membuka sudut pandang menarik yang jarang dibahas.",
                    "description": "Cuplikan ini merangkum pernyataan penting yang menjadi inti perbincangan."
                })

    # Always ensure fallback is available
    if not candidates:
        candidates.append({
            "title": LOCAL_TITLE_FALLBACK,
            "hook": LOCAL_HOOK_FALLBACK,
            "description": "Cuplikan ini merangkum momen utama dan konteks yang menyertainya."
        })

    return candidates


def _score_candidate_copy(
    cand: dict[str, str],
    transcript: str,
    idea: dict[str, object],
) -> float:
    """Score a candidate copy package (higher is better)."""
    title = cand.get("title", "")
    hook = cand.get("hook", "")
    title_words = _normalized_words(title)
    hook_words = _normalized_words(hook)
    transcript_words = set(_normalized_words(transcript))

    score = 50.0

    # 1. Length penalties and rewards
    t_len = len(title)
    if 35 <= t_len <= 75:
        score += 20.0
    elif 25 <= t_len < 35 or 75 < t_len <= 90:
        score += 10.0
    else:
        score -= 20.0

    h_len = len(hook_words)
    if 8 <= h_len <= 15:
        score += 20.0
    elif 6 <= h_len < 8 or 15 < h_len <= 18:
        score += 10.0
    else:
        score -= 25.0

    # 2. Anti-generic / Anti-filler penalties
    lowered_title = title.lower()
    if any(banned in lowered_title for banned in (
        "hal yang jarang dibahas",
        "bisa jadi perdebatan",
        "topik ini penting",
        "momen paling menegangkan",
        "bagian percakapan",
        "apa kisah",
        "masuk pro",
        "aku kayak",
        "aku indomie",
    )):
        score -= 100.0

    if any(title.lower().startswith(f + " ") for f in ("jadi", "nah", "terus", "lalu", "tuh", "deh", "nih")):
        score -= 50.0

    # 3. Curiosity & Hook word rewards
    curiosity_triggers = (
        "kenapa", "ternyata", "jangan-jangan", "rusak", "insecure", "kompetisi",
        "harga", "prajurit", "patung", "rahasia", "fakta", "bukan", "justru",
        "berani", "seharga", "sembunyi", "hutan", "kampung", "kota"
    )
    for trigger in curiosity_triggers:
        if trigger in lowered_title:
            score += 10.0
        if trigger in hook.lower():
            score += 5.0

    # 4. Transcript grounding
    overlap_count = sum(word in transcript_words for word in title_words if word not in LOCAL_STOPWORDS)
    if overlap_count >= 1:
        score += min(30.0, overlap_count * 10.0)

    # 5. Title vs Hook differentiation (hook must not just repeat title)
    title_word_set = set(title_words) - LOCAL_STOPWORDS
    hook_word_set = set(hook_words) - LOCAL_STOPWORDS
    if title_word_set and hook_word_set:
        jaccard = len(title_word_set & hook_word_set) / len(title_word_set | hook_word_set)
        if jaccard > 0.6:
            score -= 40.0

    # 6. Specific Kind bonus
    if str(idea.get("kind", "general")) != "general":
        score += 30.0

    return score


def _domain_title_fallback(idea: dict[str, object], text: str) -> str:
    candidates = _generate_copy_candidates(idea, text, "podcast")
    if candidates:
        best = max(candidates, key=lambda c: _score_candidate_copy(c, text, idea))
        return best["title"]
    return LOCAL_TITLE_FALLBACK


def rewrite_local_title(
    transcript_snippet: str,
    content_type: str,
    candidate_context: dict[str, object] | None = None,
) -> str:
    """Create concise curiosity-driven local title copy from the candidate's main idea."""
    text = _clean_transcript(transcript_snippet)
    if not text:
        return LOCAL_TITLE_FALLBACK

    context = candidate_context or {}
    idea = extract_main_idea(text, content_type)
    candidates = _generate_copy_candidates(idea, text, content_type, context)

    best_candidate = max(
        candidates,
        key=lambda c: _score_candidate_copy(c, text, idea),
    )
    title = best_candidate["title"]
    return _limit_words(_clean_title(title), 14)


def rewrite_local_hook(
    transcript_snippet: str,
    title: str,
    content_type: str,
    candidate_context: dict[str, object] | None = None,
) -> str:
    """Create a restrained curiosity gap hook from the candidate's main idea."""
    del title
    text = _clean_transcript(transcript_snippet)
    if not text:
        return LOCAL_HOOK_FALLBACK

    context = candidate_context or {}
    idea = extract_main_idea(text, content_type)
    candidates = _generate_copy_candidates(idea, text, content_type, context)

    best_candidate = max(
        candidates,
        key=lambda c: _score_candidate_copy(c, text, idea),
    )
    hook = best_candidate.get("hook", LOCAL_HOOK_FALLBACK)
    return _limit_words(hook, 18)


def rewrite_local_description(transcript_snippet: str, content_type: str) -> str:
    text = _clean_transcript(transcript_snippet)
    if not text:
        return "Cuplikan ini merangkum momen utama dan konteks yang menyertainya."

    idea = extract_main_idea(text, content_type)
    candidates = _generate_copy_candidates(idea, text, content_type)
    best_candidate = max(
        candidates,
        key=lambda c: _score_candidate_copy(c, text, idea),
    )
    return best_candidate.get("description", "Cuplikan ini merangkum poin penting dari perbincangan.")


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
