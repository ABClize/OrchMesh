"""Freeze the platform prompt for each admitted task."""
from alembic import op
import sqlalchemy as sa
revision = "c72fa91b3802"
down_revision = "b901cf7c1201"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("task", sa.Column("platform_prompt", sa.Text(), nullable=True))

def downgrade():
    op.drop_column("task", "platform_prompt")
