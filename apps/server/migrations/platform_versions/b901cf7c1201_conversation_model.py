"""Persist selected model route on conversations."""
from alembic import op
import sqlalchemy as sa
revision = "b901cf7c1201"
down_revision = "ab04e1f29117"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("conversation", sa.Column("model_id", sa.String(128), nullable=True))

def downgrade():
    op.drop_column("conversation", "model_id")
