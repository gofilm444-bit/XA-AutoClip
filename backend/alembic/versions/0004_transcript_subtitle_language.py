"""Track transcription source and render subtitle language."""

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "projects",
        sa.Column("transcript_language", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("transcript_provider", sa.String(length=40), nullable=True),
    )
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
    op.drop_column("renders", "subtitle_language")
    op.drop_column("projects", "transcript_provider")
    op.drop_column("projects", "transcript_language")
