"""Add editable social media caption."""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade():
    if not _has_column("transformation_plans", "social_caption"):
        op.add_column(
            "transformation_plans",
            sa.Column("social_caption", sa.Text(), nullable=False, server_default=""),
        )
        op.alter_column("transformation_plans", "social_caption", server_default=None)


def downgrade():
    if _has_column("transformation_plans", "social_caption"):
        op.drop_column("transformation_plans", "social_caption")

