"""Persist task lifecycle end time without estimating historical values."""
from alembic import op
import sqlalchemy as sa

revision = "ab04e1f29117"
down_revision = "790bb053f901"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("task", sa.Column("finished_at", sa.String(64), nullable=True))


def downgrade():
    op.drop_column("task", "finished_at")
