"""Add project content type for podcast and sports workflows."""

import sqlalchemy as sa

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
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
    op.drop_column("projects", "content_type")
