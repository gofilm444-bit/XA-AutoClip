from app.models import (
    ClipCandidate,
    Project,
    SourceDeclaration,
    TransformationPlan,
)
from app.services.captions import (
    generate_hashtags,
    generate_social_caption,
    naturalize_title,
    summarize_source_description,
)


def test_naturalizes_uppercase_title():
    assert naturalize_title("JUDUL VIDEO TERBARU") == "Judul video terbaru"


def test_generates_relevant_unique_hashtags():
    hashtags = generate_hashtags(
        "HIGHLIGHT | MEKSIKO VS AFRIKA SELATAN | FIFA WORLD CUP 2026"
    )
    assert hashtags == [
        "#Highlight",
        "#Meksiko",
        "#AfrikaSelatan",
        "#FifaWorldCup",
    ]


def test_hashtag_fallback_has_minimum_two():
    assert len(generate_hashtags("di dan yang")) == 2


def test_summarizes_source_description_without_urls():
    result = summarize_source_description(
        "Ringkasan pertandingan dan susunan pemain.\n"
        "TEMUKAN SOSIAL MEDIA KAMI\n"
        "Instagram: https://example.com/profil\n"
        "Analisis berlanjut setelah jeda.",
        max_chars=70,
    )
    assert "https://" not in result
    assert "Instagram" not in result
    assert "TEMUKAN" not in result
    assert result.startswith("Ringkasan pertandingan")


def test_sports_caption_uses_candidate_transcript():
    project = Project(title="Korea vs Czechia", content_type="sports")
    declaration = SourceDeclaration(
        ownership_type="third_party_commentary",
        intended_use="Analisis",
        transformation_purpose="analysis",
        user_acknowledged=True,
        source_creator="FIFA",
        source_title="Korea vs Czechia",
        source_url="https://example.com/video",
    )
    plan = TransformationPlan(
        original_hook="Gol ini dibangun dari pergerakan yang rapi.",
        new_angle="Analisis momentum.",
        conclusion="Kualitas penyelesaian menjadi pembeda.",
        engagement_question="Apakah ini gol terbaik pertandingan?",
    )
    candidate = ClipCandidate(
        start_seconds=173,
        end_seconds=203,
        suggested_title="Gol penyama kedudukan Korea",
        transcript_text="[02:54] The shot is in!\n[03:07] Korea's equalizer!",
    )

    caption = generate_social_caption(project, declaration, plan, candidate)

    assert caption.startswith("[02:54] The shot is in!")
    assert "Highlight pertandingan mulai 02:53" in caption
    assert "[03:07] Korea's equalizer!" in caption
    assert "Video ini membahas" not in caption
    assert "Sumber video: Korea vs Czechia" in caption
    assert "Link sumber: https://example.com/video" in caption
    assert "Channel sumber: FIFA" in caption
    assert caption.index("Link sumber:") < caption.index("Channel sumber:")
