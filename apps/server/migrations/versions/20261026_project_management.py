"""Separate navigation membership from the stable execution workspace."""
from alembic import op
import sqlalchemy as sa

revision = "20261026_project_management"
down_revision = "20261026_projects"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("project", sa.Column("archived", sa.Boolean(), nullable=False, server_default="0"))
    op.add_column("conversation", sa.Column("workspace_project_id", sa.Uuid(), nullable=True))
    op.execute("UPDATE conversation SET workspace_project_id = project_id")

def downgrade():
    op.drop_column("conversation", "workspace_project_id")
    op.drop_column("project", "archived")
