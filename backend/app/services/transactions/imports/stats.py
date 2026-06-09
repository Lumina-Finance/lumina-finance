"""Transaction import statistics tracking"""
import uuid
from dataclasses import dataclass, field


@dataclass
class ImportStats:
    """Track created and reused accounts, categories, merchants, and tags during a transaction import"""

    accounts_created: int = 0
    accounts_reused: int = 0
    categories_created: int = 0
    categories_reused: int = 0
    merchants_created: int = 0
    merchants_reused: int = 0
    tags_created: int = 0
    tags_reused: int = 0
    created_account_ids: list[uuid.UUID] = field(default_factory=list)
    created_category_ids: list[uuid.UUID] = field(default_factory=list)
    created_merchant_ids: list[uuid.UUID] = field(default_factory=list)
    created_tag_ids: list[uuid.UUID] = field(default_factory=list)
