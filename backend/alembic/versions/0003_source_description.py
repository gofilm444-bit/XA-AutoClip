"""Add source video description."""

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "source_declarations",
        sa.Column("source_description", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("source_declarations", "source_description")
