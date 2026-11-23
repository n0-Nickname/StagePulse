"""add_custom_filler_words

Revision ID: fcd6fdcc0eaa
Revises: 7a84e12fa40b
Create Date: 2026-11-23 16:26:57.955656

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fcd6fdcc0eaa"
down_revision: str | Sequence[str] | None = "7a84e12fa40b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "users",
        sa.Column(
            "custom_filler_words",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            server_default="[]",
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "custom_filler_words")
