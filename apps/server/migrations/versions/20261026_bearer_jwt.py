"""Retire database sessions and normalize legacy UUID storage for native SQLAlchemy.

Revision ID: 20261026_jwt
Revises: 39a33d9348dd
"""

from alembic import op
import sqlalchemy as sa

revision = "20261026_jwt"
down_revision = "39a33d9348dd"
branch_labels = None
depends_on = None


def upgrade():
    # SQLite defers FK verification until both sides use the same representation.
    op.execute("PRAGMA defer_foreign_keys=ON")
    op.drop_table("accesstoken")
    op.execute("UPDATE user SET id = replace(id, '-', '')")
    op.execute("UPDATE conversation SET user_id = replace(user_id, '-', '')")


def downgrade():
    # Sessions cannot be recovered; users must log in again after a downgrade.
    op.execute("PRAGMA defer_foreign_keys=ON")
    for table, column in (("user", "id"), ("conversation", "user_id")):
        op.execute(
            f"UPDATE {table} SET {column} = substr({column},1,8)||'-'||substr({column},9,4)||'-'||substr({column},13,4)||'-'||substr({column},17,4)||'-'||substr({column},21,12)"
        )
    op.create_table(
        "accesstoken",
        sa.Column(
            "user_id",
            sa.CHAR(36),
            sa.ForeignKey("user.id", ondelete="cascade"),
            nullable=False,
        ),
        sa.Column("token", sa.String(43), primary_key=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index("ix_accesstoken_created_at", "accesstoken", ["created_at"])
