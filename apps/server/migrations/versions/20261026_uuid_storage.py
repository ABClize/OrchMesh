"""Align early auth UUID column declarations with SQLAlchemy Uuid storage."""

import sqlalchemy as sa
from alembic import op

revision = "20261026_uuid_storage"
down_revision = "20261026_native_navigation"
branch_labels = None
depends_on = None


def upgrade():
    # Existing values are already canonical 32-character UUID hex strings.
    for table, column in (("user", "id"), ("conversation", "user_id")):
        with op.batch_alter_table(table) as batch:
            batch.alter_column(column, existing_type=sa.CHAR(36), type_=sa.Uuid())


def downgrade():
    for table, column in (("conversation", "user_id"), ("user", "id")):
        with op.batch_alter_table(table) as batch:
            batch.alter_column(column, existing_type=sa.Uuid(), type_=sa.CHAR(36))
