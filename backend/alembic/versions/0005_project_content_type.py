"""Add project content type for podcast and sports workflows."""

import sqlalchemy as sa

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade():
    if not _has_column("projects", "content_type"):
        op.add_column(
            "projects",
            sa.Column(
                "content_type",
                sa.String(length=20),
                nullable=False,
                server_default="podcast",
            ),
        )
        op.alter_column("projects", "content_type", server_default=None)


def downgrade():
    if _has_column("projects", "content_type"):
        op.drop_column("projects", "content_type")
