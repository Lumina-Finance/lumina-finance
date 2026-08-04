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
