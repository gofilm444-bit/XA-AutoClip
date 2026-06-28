import pytest

from app.core.state import ProjectStatus, validate_transition


def test_valid_project_transition():
    validate_transition(ProjectStatus.CREATED, ProjectStatus.UPLOADING)


def test_invalid_project_transition():
    with pytest.raises(ValueError):
        validate_transition(ProjectStatus.CREATED, ProjectStatus.COMPLETED)

