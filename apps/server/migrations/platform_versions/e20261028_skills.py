"""Public skill catalog and immutable bundle snapshots."""
from alembic import op
import sqlalchemy as sa
revision = 'e20261028_skills'
down_revision = 'd18c40a2f113'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('skill', sa.Column('id',sa.String(64),primary_key=True), sa.Column('name',sa.String(128),nullable=False,unique=True),sa.Column('description',sa.Text(),nullable=False),sa.Column('source',sa.Text(),nullable=False),sa.Column('revision',sa.String(64),nullable=False),sa.Column('enabled',sa.Boolean(),nullable=False))
    op.create_table('skill_revision',sa.Column('id',sa.String(64),primary_key=True),sa.Column('definition',sa.JSON(),nullable=False),sa.Column('files',sa.JSON(),nullable=False))

def downgrade():
    op.drop_table('skill')
    op.drop_table('skill_revision')
