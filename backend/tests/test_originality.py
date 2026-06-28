import uuid

from app.models import ClipCandidate, TransformationPlan
from app.services.originality import assess


def test_originality_does_not_require_voiceover_or_storyboard():
    candidate = ClipCandidate(
        id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        start_seconds=0,
        end_seconds=25,
        duration_seconds=25,
        transcript_text="Teks sumber " * 20,
        suggested_title="Judul",
        suggested_hook="Hook",
        summary="Ringkasan",
        category="edukasi",
        hook_score=80,
        context_score=80,
        information_score=80,
        emotion_score=80,
        fluency_score=80,
        duration_score=80,
        discussion_score=80,
        viral_potential_score=80,
        rank=1,
    )
    plan = TransformationPlan(
        project_id=candidate.project_id,
        candidate_id=candidate.id,
        purpose="analysis",
        new_angle="Sudut baru yang jelas",
        audience="Kreator",
        original_hook="Hook yang benar-benar baru",
        commentary_script="Analisis baru yang substantif " * 30,
        conclusion="Kesimpulan baru",
        engagement_question="Bagaimana pendapat Anda?",
        storyboard=[],
    )
    report = assess(plan, candidate)
    assert all("Voice-over" not in check["name"] for check in report["checks_json"])
    assert not any("voice-over" in warning.lower() for warning in report["warnings_json"])
