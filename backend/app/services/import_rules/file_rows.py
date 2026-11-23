"""What the rules give the rows of a file import

The preview asks it of the rows the page holds and the save asks it of the rows it writes, so both
go through the same functions and a row gets the same answer in each
"""

import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from app.services.import_rules.matching import ImportRuleMatcher, MatchCandidate, Supplied, SuppliedTag

NO_KEYS: frozenset[str] = frozenset()


@dataclass(frozen=True)
class FileRow:
    """What the fill reads of one row

    Attributes:
        candidate: The facts the rules compare
        file_tag_keys: The tags the file gives the row, as `tag_key` writes them
    """

    candidate: MatchCandidate
    file_tag_keys: frozenset[str] = NO_KEYS


@dataclass(frozen=True)
class FileRowFill:
    """What the rules give one row

    Attributes:
        merchant: The merchant the highest matching rule sets, if any
        category: The category the highest matching rule sets, if any
        tags: Every tag the matching rules add
        new_tags: The tags among them the file does not give. A tag the file gives is the file's and
            counts for no rule
        tag_count: How many tags the row ends with: the file's and the new ones
    """

    merchant: Supplied | None = None
    category: Supplied | None = None
    tags: tuple[SuppliedTag, ...] = ()
    new_tags: tuple[SuppliedTag, ...] = ()
    tag_count: int = 0

    @property
    def rule_ids(self) -> set[uuid.UUID]:
        """Return the rules that gave this row a value it ends with"""
        supplied = [self.merchant, self.category, *self.new_tags]
        return {value.rule.id for value in supplied if value is not None}


def fill_rows(matcher: ImportRuleMatcher, rows: Sequence[FileRow]) -> list[FileRowFill]:
    """Ask the rules about each row

    Pure, so it can run off the event loop

    Args:
        matcher: The person's rules
        rows: The rows' facts, in file order

    Returns:
        One answer per row, in the same order
    """
    fills = []
    for row in rows:
        match = matcher.match(row.candidate)
        if match.merchant is None and match.category is None and not match.tags:
            fills.append(FileRowFill(tag_count=len(row.file_tag_keys)))
            continue

        # A tag the file also gives is the file's, so it counts for no rule and adds nothing to the row's tags
        new_tags = tuple(tag for tag in match.tags if tag.key not in row.file_tag_keys)
        fills.append(
            FileRowFill(
                merchant=match.merchant,
                category=match.category,
                tags=match.tags,
                new_tags=new_tags,
                tag_count=len(row.file_tag_keys) + len(new_tags),
            )
        )
    return fills


def count_rows_per_rule(fills: Sequence[FileRowFill]) -> Counter[uuid.UUID]:
    """Return how many rows each rule gave a value they end with"""
    counts: Counter[uuid.UUID] = Counter()
    for fill in fills:
        counts.update(fill.rule_ids)
    return counts
