"""Remember the user's reasoning selection per conversation."""
from alembic import op
import sqlalchemy as sa

revision = '20261026_reasoning'
down_revision = '20261026_jwt'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('conversation', sa.Column('reasoning', sa.String(32), nullable=False, server_default='default'))


def downgrade():
    op.drop_column('conversation', 'reasoning')
