"""Persist any/all collaboration wait semantics."""

from alembic import op
import sqlalchemy as sa

revision = "790bb053f901"
down_revision = "28a42b38c10a"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "task_wait",
        sa.Column("mode", sa.String(8), nullable=False, server_default="all"),
    )


def downgrade():
    op.drop_column("task_wait", "mode")
