"""Projects and reversible conversation organization."""
from alembic import op
import sqlalchemy as sa

revision = "20261026_projects"
down_revision = "20261026_reasoning"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("project",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False))
    op.create_index("ix_project_user_id", "project", ["user_id"])
    op.add_column("conversation", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_index("ix_conversation_project_id", "conversation", ["project_id"])
    op.add_column("conversation", sa.Column("pinned", sa.Boolean(), nullable=False, server_default="0"))
    op.add_column("conversation", sa.Column("archived", sa.Boolean(), nullable=False, server_default="0"))

def downgrade():
    op.drop_column("conversation", "archived")
    op.drop_column("conversation", "pinned")
    op.drop_index("ix_conversation_project_id", table_name="conversation")
    op.drop_column("conversation", "project_id")
    op.drop_table("project")
