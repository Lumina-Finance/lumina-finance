"""Which importer last brought transactions into one account"""

import uuid

from sqlalchemy import VARCHAR, CheckConstraint, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.import_run import SOURCE_CHECK_VALUES


class AccountImportSource(Base):
    """The importer of the last completed import that wrote rows into one account

    An account keeps one row, replaced by each later import, so its import page can open on the source
    the user used last
    """

    __tablename__ = "account_import_sources"
    __table_args__ = (
        UniqueConstraint("account_id", name="uq_account_import_sources_account_id"),
        CheckConstraint(f"source IN ({SOURCE_CHECK_VALUES})", name="ck_account_import_sources_source"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)

    # An import run's source, so an importer added to runs is remembered without a second list
    source: Mapped[str] = mapped_column(VARCHAR(32), nullable=False)

    # The import that saved this row while it can still be undone, which undoing it reads to put back
    # what the row held before. Cleared rather than cascading when the run goes, so the row outlives it
    import_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("import_runs.id", ondelete="SET NULL"),
        index=True,
    )
