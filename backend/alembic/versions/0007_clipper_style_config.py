"""Add clipper style config per transformation."""

import sqlalchemy as sa

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade():
    if not _has_column("transformation_plans", "clipper_style_config"):
        op.add_column(
            "transformation_plans",
            sa.Column(
                "clipper_style_config",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'{}'"),
            ),
        )
        op.alter_column("transformation_plans", "clipper_style_config", server_default=None)


def downgrade():
    if _has_column("transformation_plans", "clipper_style_config"):
        op.drop_column("transformation_plans", "clipper_style_config")
