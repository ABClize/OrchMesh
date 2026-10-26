"""DSH SessionId is an opaque string, including native fork identities."""

import sqlalchemy as sa
from alembic import op

revision = "20261026_opaque_session_ids"
down_revision = "20261026_native_authority"
branch_labels = None
depends_on = None


def upgrade():
    for table, column in (("conversation", "id"), ("run", "conversation_id")):
        with op.batch_alter_table(table) as batch:
            batch.alter_column(column, existing_type=sa.Uuid(), type_=sa.String(128))
        # Earlier UUID columns persisted hex while their DSH identity used hyphens.
        op.execute(
            sa.text(
                f"UPDATE {table} SET {column} = substr({column},1,8)||'-'||substr({column},9,4)||'-'||substr({column},13,4)||'-'||substr({column},17,4)||'-'||substr({column},21,12) WHERE length({column}) = 32"
            )
        )


def downgrade():
    raise RuntimeError("Opaque native Session IDs cannot be converted to UUIDs")
