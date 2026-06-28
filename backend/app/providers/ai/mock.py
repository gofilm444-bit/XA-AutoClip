from app.models import ClipCandidate
from app.services.captions import summarize_source_description
from app.services.source_context import content_title_from_filename


def format_timestamp(seconds: float) -> str:
    minutes = int(seconds // 60)
    remainder = int(seconds % 60)
    return f"{minutes:02d}:{remainder:02d}"


class MockAIProvider:
    def transformation(
        self,
        candidate: ClipCandidate,
        purpose: str,
        audience: str,
        source_description: str | None = None,
        source_title: str | None = None,
        uploaded_filename: str | None = None,
    ) -> dict:
        source_context = summarize_source_description(source_description, max_chars=240)
        content_title = (
            content_title_from_filename(uploaded_filename)
            or source_title
            or candidate.suggested_title
        )
        clip_start = format_timestamp(candidate.start_seconds)
        clip_end = format_timestamp(candidate.end_seconds)
        context_sentence = f" Keterangan sumber menyebut: {source_context}" if source_context else ""
        if candidate.category != "sports_highlight":
            return {
                "new_angle": (
                    f"Merangkum gagasan utama dalam {content_title} dengan konteks yang "
                    f"cukup dari bagian {clip_start}-{clip_end}."
                ),
                "original_hook": (
                    "Ada satu gagasan penting di bagian ini yang mudah terlewat jika hanya "
                    "mendengar potongan akhirnya."
                ),
                "commentary_script": (
                    f"Cuplikan {clip_start}-{clip_end} menyoroti gagasan utama pembicara. "
                    "Perhatikan konteks, alasan yang diberikan, dan implikasinya bagi penonton."
                    f"{context_sentence}"
                ),
                "conclusion": "Nilai klip ini terletak pada gagasan dan konteksnya.",
                "engagement_question": (
                    "Bagian mana dari gagasan ini yang paling relevan menurut Anda?"
                ),
                "needs_fact_verification": False,
                "storyboard": [],
            }
        return {
            "new_angle": (
                f"Menganalisis perubahan momentum dan respons pertahanan dalam {content_title}, "
                f"dengan fokus pada rangkaian permainan pada {clip_start}-{clip_end}."
            ),
            "original_hook": (
                "Momen ini bukan hanya soal peluang akhir; pergerakan beberapa detik sebelumnya "
                "menjelaskan mengapa pertahanan kehilangan ruang."
            ),
            "commentary_script": (
                f"Pada cuplikan {clip_start}-{clip_end}, perhatikan urutan serangan, ruang yang "
                "terbuka, dan cara lini pertahanan merespons sebelum peluang tercipta. "
                "Nilai momennya tidak hanya terletak pada hasil akhir, tetapi pada keputusan "
                "pemain saat membangun serangan dan keterlambatan lawan menutup area berbahaya."
                f"{context_sentence}"
            ),
            "conclusion": (
                "Kunci cuplikan ini adalah perubahan ruang dan momentum, bukan sekadar adegan akhir."
            ),
            "engagement_question": (
                "Menurut Anda, keputusan pemain mana yang paling menentukan dalam rangkaian ini?"
            ),
            "needs_fact_verification": False,
            "storyboard": [
                {
                    "item_index": 0,
                    "item_type": "creator_intro",
                    "duration_seconds": 4,
                    "script_text": "Perhatikan bagaimana ruang mulai terbuka sebelum peluang ini.",
                    "source_function": None,
                },
                {
                    "item_index": 1,
                    "item_type": "source_evidence",
                    "start_seconds": candidate.start_seconds,
                    "end_seconds": min(candidate.start_seconds + 10, candidate.end_seconds),
                    "duration_seconds": min(10, candidate.duration_seconds),
                    "overlay_text": "Awal rangkaian serangan",
                    "source_function": "bukti",
                },
                {
                    "item_index": 2,
                    "item_type": "creator_analysis",
                    "duration_seconds": 18,
                    "script_text": (
                        "Analisis pergerakan pemain, ruang yang ditinggalkan, dan respons pertahanan."
                    ),
                    "source_function": None,
                },
                {
                    "item_index": 3,
                    "item_type": "creator_conclusion",
                    "duration_seconds": 10,
                    "script_text": "Perubahan momentum terjadi sebelum adegan akhir terlihat.",
                    "source_function": None,
                },
                {
                    "item_index": 4,
                    "item_type": "call_to_action",
                    "duration_seconds": 8,
                    "script_text": "Keputusan pemain mana yang paling menentukan menurut Anda?",
                    "source_function": None,
                },
            ],
        }
