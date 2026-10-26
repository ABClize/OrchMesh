"""Native DSH navigation identity and one-time import marker."""

from alembic import op
import sqlalchemy as sa

revision = "20261026_native_navigation"
down_revision = "20261026_project_management"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("project", sa.Column("native_id", sa.String(80), nullable=True))
    op.add_column(
        "conversation",
        sa.Column("native_imported", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade():
    op.drop_column("conversation", "native_imported")
    op.drop_column("project", "native_id")
