"""Track transcription source and render subtitle language."""

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade():
    if not _has_column("projects", "transcript_language"):
        op.add_column(
            "projects",
            sa.Column("transcript_language", sa.String(length=20), nullable=True),
        )
    if not _has_column("projects", "transcript_provider"):
        op.add_column(
            "projects",
            sa.Column("transcript_provider", sa.String(length=40), nullable=True),
        )
    if not _has_column("renders", "subtitle_language"):
        op.add_column(
            "renders",
            sa.Column(
                "subtitle_language",
                sa.String(length=10),
                nullable=False,
                server_default="id",
            ),
        )
        op.alter_column("renders", "subtitle_language", server_default=None)


def downgrade():
    if _has_column("renders", "subtitle_language"):
        op.drop_column("renders", "subtitle_language")
    if _has_column("projects", "transcript_provider"):
        op.drop_column("projects", "transcript_provider")
    if _has_column("projects", "transcript_language"):
        op.drop_column("projects", "transcript_language")
