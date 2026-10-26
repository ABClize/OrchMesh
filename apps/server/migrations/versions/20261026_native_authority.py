"""Keep ownership and directory bindings; DSH owns all navigation state."""

import sqlalchemy as sa
from alembic import op

revision = "20261026_native_authority"
down_revision = "20261026_uuid_storage"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    pending = bind.scalar(
        sa.text("SELECT count(*) FROM conversation WHERE native_imported = 0")
    )
    pending += bind.scalar(
        sa.text("SELECT count(*) FROM project WHERE native_id IS NULL")
    )
    if pending:
        raise RuntimeError(
            "Adopt existing metadata into DSH before removing SQL navigation copies"
        )
    with op.batch_alter_table("conversation") as batch:
        batch.alter_column(
            "workspace_project_id",
            new_column_name="directory_id",
            existing_type=sa.Uuid(),
        )
        for column in ("project_id", "native_imported", "pinned", "archived", "title"):
            if column == "project_id":
                batch.drop_index("ix_conversation_project_id")
            batch.drop_column(column)
    with op.batch_alter_table("project") as batch:
        batch.drop_column("name")
        batch.drop_column("archived")


def downgrade():
    raise RuntimeError(
        "Restore the pre-migration backup; native state has no SQL duplicate."
    )
