import re

from app.core.config import get_settings
from app.models import ClipCandidate, TransformationPlan
from app.services.repetition import maximum_similarity


def _words(value: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", value.lower())


def assess(
    plan: TransformationPlan,
    candidate: ClipCandidate,
    previous_commentaries: list[str] | None = None,
) -> dict:
    settings = get_settings()
    commentary_words = len(_words(plan.commentary_script))
    source_words = len(_words(candidate.transcript_text))
    contribution_ratio = commentary_words / max(commentary_words + source_words, 1)
    source_ratio = 1 - contribution_ratio
    checks = [
        {"name": "Sudut pembahasan baru tersedia", "passed": bool(plan.new_angle.strip())},
        {"name": "Hook orisinal tersedia", "passed": bool(plan.original_hook.strip())},
        {"name": "Komentar substantif tersedia", "passed": commentary_words >= 25},
        {"name": "Kesimpulan tersedia", "passed": bool(plan.conclusion.strip())},
    ]
    warnings: list[str] = []
    recommendations: list[str] = []
    if contribution_ratio < settings.originality_min_commentary_word_ratio:
        warnings.append("Rasio komentar orisinal masih rendah.")
        recommendations.append("Tambahkan analisis atau perbandingan yang lebih substantif.")
    if source_ratio > settings.originality_max_source_ratio:
        warnings.append("Kontribusi sumber terlalu dominan.")
        recommendations.append("Kurangi durasi sumber atau tambahkan segmen kreator.")
    creator_score = round(min(contribution_ratio * 140, 100), 2)
    transformative = round(
        min(100, creator_score * 0.7 + (30 if plan.new_angle else 0)),
        2,
    )
    dependency = round(source_ratio * 100, 2)
    repetition = maximum_similarity(plan.commentary_script, previous_commentaries or [])
    if repetition > settings.repetition_similarity_threshold:
        warnings.append("Komentar terlalu mirip dengan output terdahulu.")
        recommendations.append("Ubah struktur argumen dan contoh agar kontribusi lebih berbeda.")
    failed = sum(not item["passed"] for item in checks)
    if failed >= 2 or creator_score < 35:
        status = "transformation_required"
        risk = "high"
    elif warnings:
        status = "revision_recommended"
        risk = "medium"
    else:
        status = "ready_for_manual_review"
        risk = "low"
    return {
        "transformative_value_score": transformative,
        "creator_contribution_score": creator_score,
        "new_information_score": round(min(100, 55 + commentary_words / 2), 2),
        "source_dependency_score": dependency,
        "repetition_risk_score": round(repetition * 100, 2),
        "copyright_risk_level": risk,
        "overall_status": status,
        "checks_json": checks,
        "warnings_json": warnings,
        "recommendations_json": recommendations,
    }
