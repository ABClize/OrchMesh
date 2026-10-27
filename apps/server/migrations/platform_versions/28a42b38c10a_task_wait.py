"""Persist collaboration wait edges for cycle checks."""
from alembic import op
import sqlalchemy as sa

revision = "28a42b38c10a"
down_revision = "653cddaf737e"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("task_wait",
                    sa.Column("waiter_id", sa.String(64), primary_key=True),
                    sa.Column("dependency_id", sa.String(64), primary_key=True),
                    sa.Column("root_id", sa.String(64), nullable=False))
    op.create_index("ix_task_wait_root_id", "task_wait", ["root_id"])


def downgrade():
    op.drop_table("task_wait")
