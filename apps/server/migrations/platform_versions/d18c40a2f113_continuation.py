"""Freeze task continuation instruction."""
from alembic import op
import sqlalchemy as sa
revision = "d18c40a2f113"
down_revision = "c72fa91b3802"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("task", sa.Column("continuation_prompt", sa.Text(), nullable=True))

def downgrade():
    op.drop_column("task", "continuation_prompt")
