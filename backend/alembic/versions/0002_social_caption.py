"""Add editable social media caption."""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "transformation_plans",
        sa.Column("social_caption", sa.Text(), nullable=False, server_default=""),
    )
    op.alter_column("transformation_plans", "social_caption", server_default=None)


def downgrade():
    op.drop_column("transformation_plans", "social_caption")

