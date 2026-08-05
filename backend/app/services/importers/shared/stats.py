"""Transaction import statistics tracking"""
import uuid
from dataclasses import dataclass, field


@dataclass
class ImportStats:
    """Track created and reused accounts, categories, merchants, and tags during a transaction import

    Reuse is held as the records reused rather than as a count, because a merchant appearing on a
    thousand rows is one merchant reused, and counting each row that referenced it, or each source
    declared for it, reports something the summary does not claim
    """

    accounts_created: int = 0
    categories_created: int = 0
    merchants_created: int = 0
    tags_created: int = 0
    reused_account_ids: set[uuid.UUID] = field(default_factory=set)
    reused_category_ids: set[uuid.UUID] = field(default_factory=set)
    reused_merchant_ids: set[uuid.UUID] = field(default_factory=set)
    reused_tag_ids: set[uuid.UUID] = field(default_factory=set)
    created_account_ids: list[uuid.UUID] = field(default_factory=list)
    created_category_ids: list[uuid.UUID] = field(default_factory=list)
    created_merchant_ids: list[uuid.UUID] = field(default_factory=list)
    created_tag_ids: list[uuid.UUID] = field(default_factory=list)

    @property
    def accounts_reused(self) -> int:
        """How many accounts the import used that it did not create"""
        return _count_reused(self.reused_account_ids, self.created_account_ids)

    @property
    def categories_reused(self) -> int:
        """How many categories the import used that it did not create"""
        return _count_reused(self.reused_category_ids, self.created_category_ids)

    @property
    def merchants_reused(self) -> int:
        """How many merchants the import used that it did not create"""
        return _count_reused(self.reused_merchant_ids, self.created_merchant_ids)

    @property
    def tags_reused(self) -> int:
        """How many tags the import used that it did not create"""
        return _count_reused(self.reused_tag_ids, self.created_tag_ids)


def _count_reused(reused_ids: set[uuid.UUID], created_ids: list[uuid.UUID]) -> int:
    """Count records reused without counting ones this import made

    A name met on a later row is found in the same lookup whether an earlier row created it or it
    was already there, so a record the import created reaches the reused set as well and is taken
    back out here, which keeps the created and reused counts describing different records
    """
    return len(reused_ids - set(created_ids))
