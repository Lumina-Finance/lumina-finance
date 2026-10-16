"""How a CSV file with a given header row was last read for one account"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import VARCHAR, DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AccountImportLayout(Base):
    """The settings a completed CSV import into one account used, kept for the next file with the same headers

    An account keeps one row per header row it has seen, so a bank's web and mobile exports each keep
    their own. The settings themselves are checked by the request that carries them, not here
    """

    __tablename__ = "account_import_layouts"
    __table_args__ = (
        UniqueConstraint("account_id", "header_key", name="uq_account_import_layouts_account_header_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)

    # SHA-256 of the header cells, so a row is found by its headers without an index over a list of
    # any length. The separator is not part of it, since it is one of the settings a later file replaces
    header_key: Mapped[str] = mapped_column(VARCHAR(64), nullable=False)
    headers: Mapped[list[str]] = mapped_column(JSONB, nullable=False)

    delimiter: Mapped[str] = mapped_column(VARCHAR(1), nullable=False)

    # Counted from 1 over the file's non-blank lines, as the import page counts it
    header_row: Mapped[int] = mapped_column(Integer, nullable=False)

    # Each app field the file fills, mapped to the header holding it. The account column is never kept,
    # since the account is what the layout is saved under
    column_map: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False)
    date_format: Mapped[str] = mapped_column(VARCHAR(16), nullable=False)
    amount_format: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    # The import that saved this row while it can still be undone, which undoing it reads to put back
    # what the row held before. Cleared rather than cascading when the run goes, so the layout outlives it
    import_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("import_runs.id", ondelete="SET NULL"), index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
