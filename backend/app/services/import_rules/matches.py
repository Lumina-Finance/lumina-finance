"""Telling the import page what the rules would give the rows it holds"""

import asyncio
from collections.abc import Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.currency import Currency
from app.models.user import User
from app.schemas.import_rule import (
    ImportRuleGivenValue,
    ImportRuleReference,
    ImportRuleRowCount,
    ImportRuleRowMatch,
    MatchImportRuleRow,
    MatchImportRulesRequest,
    MatchImportRulesResponse,
)
from app.services.import_rules.file_rows import NO_KEYS, FileRow, FileRowFill, FillTargets, count_rows_per_rule, fill_rows, load_fill_targets
from app.services.import_rules.loading import load_import_rules, tag_key
from app.services.import_rules.matching import ImportRuleMatcher, MatchCandidate, Supplied
from app.utils.money import DecimalAmountParseError, DecimalAmountPrecisionError, parse_decimal_amount_to_minor_units


async def match_import_rows(db: AsyncSession, user: User, data: MatchImportRulesRequest) -> MatchImportRulesResponse:
    """Return what the user's rules give each row, and how many rows each rule gave something

    An amount that can't be read in its currency matches no Amount or Direction condition, since the
    save refuses such a row before any rule runs. The matching runs off the event loop

    Args:
        db: Active database session
        user: Authenticated user
        data: The rows, as the import page holds them

    Returns:
        One answer per row in the order sent, the counts of the rules that gave something, and the
        version of the rules read
    """
    loaded = await load_import_rules(db, user.id)
    if not loaded.rules:
        return MatchImportRulesResponse(rows=[_empty_row(row) for row in data.rows], rules=[], rules_version=loaded.version)

    codes = {row.currency for row in data.rows}
    exponents = dict((await db.execute(select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(codes)))).tuples().all())
    fills = await asyncio.to_thread(_fill_request_rows, loaded.build_matcher(), data.rows, exponents)
    targets = await load_fill_targets(db, user.id, fills)

    counts = count_rows_per_rule(fills)
    return MatchImportRulesResponse(
        rows=[_build_row(fill, targets) for fill in fills],
        rules=[
            ImportRuleRowCount(rule=ImportRuleReference(id=rule.id, name=rule.name), row_count=counts[rule.id])
            for rule in loaded.rules
            if counts[rule.id] > 0
        ],
        rules_version=loaded.version,
    )


def _fill_request_rows(matcher: ImportRuleMatcher, rows: Sequence[MatchImportRuleRow], exponents: Mapping[str, int]) -> list[FileRowFill]:
    """Read the request's rows into the facts the rules compare and fill them, with nothing of the session in hand"""
    return fill_rows(matcher, [_read_row(row, exponents) for row in rows])


def _read_row(row: MatchImportRuleRow, exponents: Mapping[str, int]) -> FileRow:
    """Return the facts of one request row, with the amount read in its currency or left out when it can't be"""
    amount = None
    if row.currency in exponents:
        try:
            amount = parse_decimal_amount_to_minor_units(row.amount, currency_code=row.currency, minor_unit_exponent=exponents[row.currency])
        except DecimalAmountParseError, DecimalAmountPrecisionError:
            amount = None
    candidate = MatchCandidate(row.description, row.note, amount, row.currency, row.account_id, row.is_transfer)
    return FileRow(candidate, _file_tag_keys(row))


def _file_tag_keys(row: MatchImportRuleRow) -> frozenset[str]:
    """Return the tags the file gives a row as the rules' tags are compared with them, blanks and repeats left out"""
    return frozenset(tag_key(name) for name in row.tag_names if name.strip()) if row.tag_names else NO_KEYS


def _empty_row(row: MatchImportRuleRow) -> ImportRuleRowMatch:
    """Return the answer for a row the rules give nothing: it ends with the tags its file gives"""
    return ImportRuleRowMatch(merchant=None, category=None, tags=[], tag_count=len(_file_tag_keys(row)))


def _given(supplied: Supplied, name: str) -> ImportRuleGivenValue:
    """Return a value a rule gives, with its name and the rule behind it"""
    return ImportRuleGivenValue(id=supplied.value, name=name, rule=ImportRuleReference(id=supplied.rule.id, name=supplied.rule.name))


def _build_row(fill: FileRowFill, targets: FillTargets) -> ImportRuleRowMatch:
    """Return one row's answer with the names of what the rules give it"""
    return ImportRuleRowMatch(
        merchant=None if fill.merchant is None else _given(fill.merchant, targets.merchants[fill.merchant.value].name),
        category=None if fill.category is None else _given(fill.category, targets.categories[fill.category.value].name),
        tags=[_given(tag, targets.tags[tag.value].name) for tag in fill.new_tags],
        tag_count=fill.tag_count,
    )
