"""Add persisted top clip asset paths."""

import sqlalchemy as sa

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade():
    if not _has_column("clip_candidates", "short_source_clip_path"):
        op.add_column(
            "clip_candidates",
            sa.Column("short_source_clip_path", sa.String(length=1000), nullable=True),
        )
    if not _has_column("clip_candidates", "clip_thumbnail_path"):
        op.add_column(
            "clip_candidates",
            sa.Column("clip_thumbnail_path", sa.String(length=1000), nullable=True),
        )
    if not _has_column("clip_candidates", "file_missing"):
        op.add_column(
            "clip_candidates",
            sa.Column(
                "file_missing",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
        op.alter_column("clip_candidates", "file_missing", server_default=None)


def downgrade():
    if _has_column("clip_candidates", "file_missing"):
        op.drop_column("clip_candidates", "file_missing")
    if _has_column("clip_candidates", "clip_thumbnail_path"):
        op.drop_column("clip_candidates", "clip_thumbnail_path")
    if _has_column("clip_candidates", "short_source_clip_path"):
        op.drop_column("clip_candidates", "short_source_clip_path")
