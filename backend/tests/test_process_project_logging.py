import app.tasks as tasks


def test_process_project_timing_payload_contains_each_required_field_once():
    payload = tasks.build_process_project_timing_payload(
        "project-1",
        {
            "video_probe_duration_ms": 1.234,
            "audio_extract_duration_ms": 2.345,
            "candidate_generation_duration_ms": 3.456,
            "title_hook_generation_total_duration_ms": 4.567,
        },
        title_hook_generation_call_count=0,
        total_process_project_duration_ms=12.345,
    )

    assert payload == {
        "project_id": "project-1",
        "video_probe_duration_ms": 1.23,
        "audio_extract_duration_ms": 2.35,
        "candidate_generation_duration_ms": 3.46,
        "title_hook_generation_total_duration_ms": 4.57,
        "title_hook_generation_call_count": 0,
        "total_process_project_duration_ms": 12.35,
    }


def test_process_project_timing_logging_failure_is_observability_only(monkeypatch):
    warnings = []

    class FailingLogger:
        def info(self, event, **fields):
            raise TypeError("logging failure")

        def warning(self, event, **fields):
            warnings.append((event, fields))

    monkeypatch.setattr(tasks, "logger", FailingLogger())

    tasks.log_process_project_timing_completed({"project_id": "project-1"})

    assert warnings == [
        (
            "process_project_timing_logging_failed",
            {"project_id": "project-1", "error": "logging failure"},
        )
    ]
