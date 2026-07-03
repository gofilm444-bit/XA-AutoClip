"""Add source video description."""

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade():
    if not _has_column("source_declarations", "source_description"):
        op.add_column(
            "source_declarations",
            sa.Column("source_description", sa.Text(), nullable=True),
        )


def downgrade():
    if _has_column("source_declarations", "source_description"):
        op.drop_column("source_declarations", "source_description")
