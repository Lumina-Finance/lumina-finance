"""Staged transaction import models"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import VARCHAR, CheckConstraint, DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ImportRunSource(enum.StrEnum):
    """The importer a run came from

    Actual Budget is held for its own importer, which has no rows of its own yet, so the API opens
    only the first two
    """

    GENERIC = "generic"
    FIREFLY = "firefly"
    ACTUAL_BUDGET = "actual_budget"


_SOURCE_CHECK_VALUES = ", ".join(f"'{source}'" for source in ImportRunSource)


class ImportRun(Base):
    """One attempt to import a file, from the first staged batch to the commit

    A file too large for one request is staged over several, and none of it reaches the ledger
    until the commit writes the whole run in a single transaction. The run holds what every batch
    shares: who it belongs to, how many rows the file will write, and the account, category and
    merchant mappings each batch merges into
    """

    __tablename__ = "import_runs"
    __table_args__ = (
        CheckConstraint(f"source IN ({_SOURCE_CHECK_VALUES})", name="ck_import_runs_source"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Which importer opened the run, which decides what its staged rows hold and which commit
    # writes them. Defaulted in the database as well, so a run staged before this column existed
    # reads as the generic CSV import it was
    source: Mapped[str] = mapped_column(
        VARCHAR(32), nullable=False, default=ImportRunSource.GENERIC, server_default=ImportRunSource.GENERIC.value,
    )

    # What the file will write, checked against the staged rows before a commit runs, so a run
    # missing a batch is refused rather than importing part of a file. For a Firefly III run this
    # counts journal rows, which a transfer between two imported accounts writes twice
    expected_transaction_count: Mapped[int] = mapped_column(Integer, nullable=False)

    # Each batch carries the mappings its own rows reference, merged in here by source, so the
    # commit resolves every row against one set of answers
    account_mappings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    category_mappings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    # Only the payee values the user answered by hand, so a run whose merchants were all left to
    # match or be created by name holds none. Defaulted in the database as well, so a run staged
    # before this column existed reads as one that answered nothing
    merchant_mappings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}",
    )

    # What a provider import writes after its transactions: budgets whose tracked categories are
    # named by category mapping source, since a category the import creates has no id until the
    # commit, and the account mapping sources to archive once everything else is written
    budget_drafts: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]",
    )
    archive_account_sources: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]",
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Set once the run has been written to the ledger, with the summary it returned. A commit whose
    # response was lost is answered from these rather than importing the file a second time
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class ImportStagedRow(Base):
    """One row of a staged file, parked until its run is committed

    Nothing outside the commit reads these, so a run abandoned before it commits leaves rows that
    are invisible rather than transactions in the ledger
    """

    __tablename__ = "import_staged_rows"
    __table_args__ = (
        # Re-sending a batch whose response was lost stages the same positions again, so the
        # unique constraint is what makes that resend harmless instead of duplicating the rows
        UniqueConstraint("import_run_id", "row_index", name="uq_import_staged_row_run_index"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    import_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("import_runs.id", ondelete="CASCADE"), nullable=False
    )

    # Repeated from the run so the row-level security policy compares a column on this table
    # rather than reading the run, which every staged row would otherwise have to do
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Position in the file, which orders the commit and keeps a batch sent twice from staging its
    # rows twice
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
