"""The CSV files of the data export, each built from one query streamed in chunks

Every cell is text: names and notes pass through the spreadsheet formula guard, amounts are written
in major units at their currency's exponent, dates are ``YYYY-MM-DD`` and instants ISO 8601 in UTC.
No id, hash, token or credential is selected, so none can reach a file
"""

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import Row, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, TaxAdvantagedCategory, TaxAdvantagedCategoryLimit
from app.models.bank_connection import BankAccountLink, BankConnection
from app.models.bank_transaction import BankTransaction
from app.models.base import TransferCounterpartyScope
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.category import Category
from app.models.import_run import ImportRun
from app.models.institution import Institution
from app.models.merchant import Merchant
from app.models.saved_insights_range import SavedInsightsRange
from app.models.tag import Tag
from app.models.transaction import Transaction
from app.models.transaction_link import TransactionLink
from app.models.user import User, UserCreditExcludedAccount, UserRunwayAccount
from app.services.csv_export import EXPORT_CHUNK_SIZE, format_minor_units, neutralize_spreadsheet_formula
from app.services.data_export.labels import (
    ACCOUNT_KINDS,
    ACCOUNT_TYPES,
    BANK_LINK_STATES,
    BANK_REVIEW_STATUSES,
    CATEGORY_KINDS,
    DATE_FORMATS,
    IMPORT_SOURCES,
    INSIGHTS_QUALIFIERS,
    MONTHS,
    OUTSIDE_ACCOUNT,
    RECURRENCE_FREQUENCIES,
    TAX_TREATMENTS,
    WEEKDAYS,
    label,
)
from app.services.data_export.references import (
    ACCOUNT_ORDER,
    BUDGET_ORDER,
    CATEGORY_ORDER,
    TAX_ADVANTAGED_CATEGORY_ORDER,
    ExportReferences,
    Reference,
)
from app.services.data_export.scope import (
    is_personal_account,
    is_personal_budget,
    is_personal_category,
    is_personal_merchant,
    is_personal_tag,
    is_personal_tax_advantaged_category,
    personal_account_ids,
)
from app.services.transactions.export import EXPORT_COLUMNS
from app.services.transactions.response_helpers import get_merchant_names_batch, get_tags_batch

type RowChunks = AsyncIterator[list[list[str]]]
type RowBuilder = Callable[[AsyncSession, uuid.UUID, ExportReferences], RowChunks]


@dataclass(frozen=True)
class DataExportFile:
    """One CSV file of the export, with the header it opens with and how its rows are produced"""

    name: str
    header: tuple[str, ...]
    rows: RowBuilder


def _cell(value: Any) -> str:
    """Write one value as the text of a cell, guarding text against running as a spreadsheet formula"""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float):
        return f"{value:g}"
    if isinstance(value, int):
        return str(value)
    return neutralize_spreadsheet_formula(str(value))


def _money(amount: int | None, currency: str, references: ExportReferences) -> str:
    """Write minor units as major units at the currency's exponent, or an empty cell when there is none"""
    if amount is None:
        return ""
    return format_minor_units(amount, references.exponents[currency])


def _reference_cells(reference: Reference | None) -> list[str]:
    """Write the name and number of a row pointed at, both empty when the row is outside the export"""
    if reference is None:
        return ["", ""]
    return [_cell(reference.name), str(reference.number)]


def _category_cells(category_id: uuid.UUID | None, references: ExportReferences) -> list[str]:
    """Write a category's name and number, the number empty for one every user shares since no file lists it"""
    name = references.category_names.get(category_id, "") if category_id else ""
    reference = references.categories.get(category_id) if category_id else None
    return [_cell(name), str(reference.number) if reference else ""]


async def _stream(db: AsyncSession, query: Select[Any]) -> AsyncIterator[list[Row[Any]]]:
    """Read a query through one server-side cursor, a chunk of rows at a time

    The session only reads: a commit or rollback would end the snapshot and close the cursor
    """
    result = await db.stream(query.execution_options(yield_per=EXPORT_CHUNK_SIZE))
    async for rows in result.partitions():
        yield rows


async def _profile_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = select(
        User.email,
        User.first_name,
        User.last_name,
        User.tz,
        User.base_currency,
        User.date_format,
        User.runway_risky_below_months,
        User.runway_healthy_at_months,
    ).where(User.id == user_id)
    async for rows in _stream(db, query):
        yield [
            [
                _cell(row.email),
                _cell(row.first_name),
                _cell(row.last_name),
                _cell(row.tz),
                _cell(row.base_currency),
                _cell(label(DATE_FORMATS, row.date_format)),
                _cell(row.runway_risky_below_months),
                _cell(row.runway_healthy_at_months),
            ]
            for row in rows
        ]


async def _accounts_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = (
        select(
            Account.id,
            Account.name,
            Account.account_kind,
            Account.account_type,
            Account.currency,
            Institution.name.label("institution"),
            Account.tax_advantaged_category_id,
            Account.credit_limit,
            Account.is_archived,
            Account.notes,
            Account.created_at,
            UserRunwayAccount.account_id.is_not(None).label("counts_toward_runway"),
            UserCreditExcludedAccount.account_id.is_not(None).label("left_out_of_credit_utilization"),
        )
        .outerjoin(Institution, Institution.id == Account.institution_id)
        .outerjoin(UserRunwayAccount, (UserRunwayAccount.account_id == Account.id) & (UserRunwayAccount.user_id == user_id))
        .outerjoin(
            UserCreditExcludedAccount,
            (UserCreditExcludedAccount.account_id == Account.id) & (UserCreditExcludedAccount.user_id == user_id),
        )
        .where(is_personal_account(user_id))
        .order_by(*ACCOUNT_ORDER)
    )
    async for rows in _stream(db, query):
        yield [
            [
                str(references.accounts[row.id].number),
                _cell(row.name),
                _cell(label(ACCOUNT_KINDS, row.account_kind)),
                _cell(label(ACCOUNT_TYPES, row.account_type)),
                row.currency,
                _cell(row.institution),
                *_reference_cells(references.tax_advantaged_categories.get(row.tax_advantaged_category_id)),
                _money(row.credit_limit, row.currency, references),
                _cell(row.is_archived),
                _cell(row.notes),
                _cell(row.created_at),
                _cell(row.counts_toward_runway),
                _cell(row.left_out_of_credit_utilization),
            ]
            for row in rows
        ]


async def _transactions_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    # Numbered newest first inside the database, so a refund can name the number of the expense it
    # refunds without the export holding every transaction's number in memory
    numbered = (
        select(
            Transaction.id.label("id"),
            func.row_number().over(order_by=(Transaction.dt.desc(), Transaction.created_at.desc(), Transaction.id.desc())).label("number"),
        )
        .where(Transaction.account_id.in_(personal_account_ids(user_id)))
        .cte("numbered")
    )
    original = numbered.alias("original")
    query = (
        select(
            Transaction.id,
            numbered.c.number,
            Transaction.dt,
            Transaction.merchant_id,
            Transaction.category_id,
            Transaction.account_id,
            Transaction.amount,
            Transaction.currency,
            Transaction.notes,
            Transaction.counterparty_account_id,
            Transaction.counterparty_account_scope,
            original.c.number.label("refund_of_number"),
        )
        .join(numbered, numbered.c.id == Transaction.id)
        .outerjoin(TransactionLink, TransactionLink.refund_transaction_id == Transaction.id)
        .outerjoin(original, original.c.id == TransactionLink.original_transaction_id)
        .order_by(numbered.c.number)
    )
    async for rows in _stream(db, query):
        merchant_names = await get_merchant_names_batch(db, [row.merchant_id for row in rows])
        tags = await get_tags_batch(db, [row.id for row in rows])
        yield [
            [
                str(row.number),
                row.dt.isoformat(),
                _cell(merchant_names.get(row.merchant_id)),
                _cell(references.category_names[row.category_id]),
                _cell(references.accounts[row.account_id].name),
                _cell(", ".join(tag.name for tag in tags[row.id])),
                _money(row.amount, row.currency, references),
                row.currency,
                _cell(row.notes),
                str(references.accounts[row.account_id].number),
                # A transfer into an account outside the export, such as a group's, leaves these empty.
                # A transfer recorded as leaving the app names it in the screen's words, with no number
                # since no account holds it
                *(
                    [OUTSIDE_ACCOUNT, ""]
                    if row.counterparty_account_scope == TransferCounterpartyScope.OUTSIDE
                    else _reference_cells(references.accounts.get(row.counterparty_account_id))
                ),
                _cell(row.refund_of_number),
            ]
            for row in rows
        ]


async def _categories_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = select(Category.id, Category.name, Category.kind, Category.icon).where(is_personal_category(user_id)).order_by(*CATEGORY_ORDER)
    async for rows in _stream(db, query):
        yield [
            [str(references.categories[row.id].number), _cell(row.name), _cell(label(CATEGORY_KINDS, row.kind)), _cell(row.icon)]
            for row in rows
        ]


async def _merchants_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = select(Merchant.name, Merchant.default_category_id).where(is_personal_merchant(user_id)).order_by(Merchant.created_at, Merchant.id)
    async for rows in _stream(db, query):
        yield [[_cell(row.name), *_category_cells(row.default_category_id, references)] for row in rows]


async def _tags_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = select(Tag.name).where(is_personal_tag(user_id)).order_by(Tag.created_at, Tag.id)
    async for rows in _stream(db, query):
        yield [[_cell(row.name)] for row in rows]


async def _budgets_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = (
        select(
            BaseBudget.id,
            BaseBudget.name,
            BaseBudget.currency,
            BaseBudget.recurs,
            BaseBudget.recurrence_freq,
            BaseBudget.instance_length,
            BaseBudget.recurrence_weekday,
            BaseBudget.recurrence_dom,
            BaseBudget.recurrence_month,
            BaseBudget.is_archived,
        )
        .where(is_personal_budget(user_id))
        .order_by(*BUDGET_ORDER)
    )
    async for rows in _stream(db, query):
        yield [
            [
                str(references.budgets[row.id].number),
                _cell(row.name),
                row.currency,
                _cell(row.recurs),
                _cell(label(RECURRENCE_FREQUENCIES, row.recurrence_freq)),
                _cell(row.instance_length),
                _cell(label(WEEKDAYS, row.recurrence_weekday)),
                _cell(row.recurrence_dom),
                _cell(label(MONTHS, row.recurrence_month)),
                _cell(row.is_archived),
            ]
            for row in rows
        ]


async def _budget_categories_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = (
        select(
            BudgetTrackedCategory.base_budget_id,
            BudgetTrackedCategory.category_id,
            BudgetTrackedCategory.added_at,
            BudgetTrackedCategory.removed_at,
        )
        .join(BaseBudget, BaseBudget.id == BudgetTrackedCategory.base_budget_id)
        .join(Category, Category.id == BudgetTrackedCategory.category_id)
        .where(is_personal_budget(user_id))
        .order_by(*BUDGET_ORDER, BudgetTrackedCategory.added_at, *CATEGORY_ORDER, BudgetTrackedCategory.id)
    )
    async for rows in _stream(db, query):
        yield [
            [
                *_reference_cells(references.budgets[row.base_budget_id]),
                *_category_cells(row.category_id, references),
                _cell(row.added_at),
                _cell(row.removed_at),
            ]
            for row in rows
        ]


async def _budget_periods_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = (
        select(Budget.base_budget_id, Budget.period_start, Budget.period_end, Budget.overall_limit, BaseBudget.currency)
        .join(BaseBudget, BaseBudget.id == Budget.base_budget_id)
        .where(is_personal_budget(user_id))
        .order_by(*BUDGET_ORDER, Budget.period_start)
    )
    async for rows in _stream(db, query):
        yield [
            [
                *_reference_cells(references.budgets[row.base_budget_id]),
                _cell(row.period_start),
                _cell(row.period_end),
                _money(row.overall_limit, row.currency, references),
            ]
            for row in rows
        ]


async def _tax_advantaged_categories_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = (
        select(
            TaxAdvantagedCategory.id,
            TaxAdvantagedCategory.name,
            TaxAdvantagedCategory.tax_treatment,
            TaxAdvantagedCategory.currency,
            TaxAdvantagedCategory.lifetime_contribution_limit,
            TaxAdvantagedCategory.accrued_contributions,
            TaxAdvantagedCategory.counts_internal_transfers,
        )
        .where(is_personal_tax_advantaged_category(user_id))
        .order_by(*TAX_ADVANTAGED_CATEGORY_ORDER)
    )
    async for rows in _stream(db, query):
        yield [
            [
                str(references.tax_advantaged_categories[row.id].number),
                _cell(row.name),
                _cell(label(TAX_TREATMENTS, row.tax_treatment)),
                row.currency,
                _money(row.lifetime_contribution_limit, row.currency, references),
                _money(row.accrued_contributions, row.currency, references),
                _cell(row.counts_internal_transfers),
            ]
            for row in rows
        ]


async def _tax_advantaged_category_limits_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = (
        select(
            TaxAdvantagedCategoryLimit.tax_advantaged_category_id,
            TaxAdvantagedCategoryLimit.year,
            TaxAdvantagedCategoryLimit.contribution_limit,
            TaxAdvantagedCategoryLimit.withdrawal_limit,
            TaxAdvantagedCategoryLimit.accrued_contributions,
            TaxAdvantagedCategoryLimit.accrued_withdrawals,
            TaxAdvantagedCategory.currency,
        )
        .join(TaxAdvantagedCategory, TaxAdvantagedCategory.id == TaxAdvantagedCategoryLimit.tax_advantaged_category_id)
        .where(is_personal_tax_advantaged_category(user_id))
        .order_by(*TAX_ADVANTAGED_CATEGORY_ORDER, TaxAdvantagedCategoryLimit.year)
    )
    async for rows in _stream(db, query):
        yield [
            [
                *_reference_cells(references.tax_advantaged_categories[row.tax_advantaged_category_id]),
                _cell(row.year),
                _money(row.contribution_limit, row.currency, references),
                _money(row.withdrawal_limit, row.currency, references),
                _money(row.accrued_contributions, row.currency, references),
                _money(row.accrued_withdrawals, row.currency, references),
            ]
            for row in rows
        ]


async def _saved_insights_ranges_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = (
        select(SavedInsightsRange.name, SavedInsightsRange.amount, SavedInsightsRange.unit, SavedInsightsRange.qualifier)
        .where(SavedInsightsRange.user_id == user_id)
        .order_by(SavedInsightsRange.created_at, SavedInsightsRange.id)
    )
    async for rows in _stream(db, query):
        yield [[_cell(row.name), _cell(row.amount), _cell(row.unit), _cell(label(INSIGHTS_QUALIFIERS, row.qualifier))] for row in rows]


async def _bank_connections_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    # The provider's display name, never its identifier, and nothing of the stored sign-in credential
    query = (
        select(BankConnection.provider_name, BankConnection.nickname, BankConnection.created_at, BankConnection.last_success_at)
        .where(BankConnection.owner_id == user_id)
        .order_by(BankConnection.created_at, BankConnection.id)
    )
    async for rows in _stream(db, query):
        yield [[_cell(value) for value in row] for row in rows]


async def _bank_links_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = (
        select(
            BankAccountLink.account_id,
            BankAccountLink.external_account_name,
            BankAccountLink.institution_name,
            BankAccountLink.state,
            BankAccountLink.linked_at,
            BankAccountLink.unlinked_at,
        )
        .where(BankAccountLink.owner_id == user_id, BankAccountLink.account_id.in_(personal_account_ids(user_id)))
        .order_by(BankAccountLink.linked_at, BankAccountLink.id)
    )
    async for rows in _stream(db, query):
        yield [
            [
                *_reference_cells(references.accounts[row.account_id]),
                _cell(row.external_account_name),
                _cell(row.institution_name),
                _cell(label(BANK_LINK_STATES, row.state)),
                _cell(row.linked_at),
                _cell(row.unlinked_at),
            ]
            for row in rows
        ]


def _bank_amount(row: Row[Any], references: ExportReferences) -> str:
    """Write a bank transaction's amount, or the text the bank sent when it couldn't be stored exactly"""
    currency = references.accounts[row.account_id].currency
    if row.observed_amount is not None:
        return _money(row.observed_amount, currency, references)
    if row.raw_amount is None:
        return ""
    try:
        Decimal(row.raw_amount)
    except InvalidOperation:
        return _cell(row.raw_amount)
    return row.raw_amount


async def _bank_items_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    query = (
        select(
            BankTransaction.account_id,
            BankTransaction.observed_date,
            BankTransaction.observed_amount,
            BankTransaction.raw_amount,
            BankTransaction.description,
            BankTransaction.merchant,
            BankTransaction.note,
            BankTransaction.disposition,
            BankTransaction.removed_at,
        )
        .where(BankTransaction.owner_id == user_id, BankTransaction.account_id.in_(personal_account_ids(user_id)))
        .order_by(BankTransaction.received_at, BankTransaction.id)
    )
    async for rows in _stream(db, query):
        yield [
            [
                *_reference_cells(references.accounts[row.account_id]),
                _cell(row.observed_date),
                _bank_amount(row, references),
                references.accounts[row.account_id].currency,
                _cell(row.description),
                _cell(row.merchant),
                _cell(row.note),
                _cell(label(BANK_REVIEW_STATUSES, row.disposition)),
                _cell(row.removed_at),
            ]
            for row in rows
        ]


async def _imports_rows(db: AsyncSession, user_id: uuid.UUID, references: ExportReferences) -> RowChunks:
    # Only runs that were saved: one never saved wrote nothing and is cleared away
    query = (
        select(ImportRun.source, ImportRun.file_name, ImportRun.created_at, ImportRun.committed_at, ImportRun.expected_transaction_count)
        .where(ImportRun.owner_id == user_id, ImportRun.committed_at.is_not(None))
        .order_by(ImportRun.created_at, ImportRun.id)
    )
    async for rows in _stream(db, query):
        yield [
            [
                _cell(label(IMPORT_SOURCES, row.source)),
                _cell(row.file_name),
                _cell(row.created_at),
                _cell(row.committed_at),
                _cell(row.expected_transaction_count),
            ]
            for row in rows
        ]


# In the order the archive holds them
DATA_EXPORT_FILES: tuple[DataExportFile, ...] = (
    DataExportFile(
        "profile.csv",
        (
            "Email",
            "First name",
            "Last name",
            "Timezone",
            "Base currency",
            "Date format",
            "Runway risky below months",
            "Runway healthy at months",
        ),
        _profile_rows,
    ),
    DataExportFile(
        "accounts.csv",
        (
            "Number",
            "Name",
            "Kind",
            "Type",
            "Currency",
            "Institution",
            "Tax-advantaged category",
            "Tax-advantaged category number",
            "Credit limit",
            "Archived",
            "Notes",
            "Created",
            "Counts toward runway",
            "Left out of credit utilization",
        ),
        _accounts_rows,
    ),
    DataExportFile(
        "transactions.csv",
        (
            "Number",
            *EXPORT_COLUMNS,
            "Account number",
            "Transfer account",
            "Transfer account number",
            "Refund of transaction number",
        ),
        _transactions_rows,
    ),
    DataExportFile("categories.csv", ("Number", "Name", "Kind", "Icon"), _categories_rows),
    DataExportFile("merchants.csv", ("Name", "Default category", "Default category number"), _merchants_rows),
    DataExportFile("tags.csv", ("Name",), _tags_rows),
    DataExportFile(
        "budgets.csv",
        ("Number", "Name", "Currency", "Repeats", "Frequency", "Interval", "Weekday", "Day of month", "Month", "Archived"),
        _budgets_rows,
    ),
    DataExportFile(
        "budget_categories.csv",
        ("Budget", "Budget number", "Category", "Category number", "Added", "Removed"),
        _budget_categories_rows,
    ),
    DataExportFile("budget_periods.csv", ("Budget", "Budget number", "Start", "End", "Limit"), _budget_periods_rows),
    DataExportFile(
        "tax_advantaged_categories.csv",
        ("Number", "Name", "Tax treatment", "Currency", "Lifetime limit", "Accrued", "Counts internal transfers"),
        _tax_advantaged_categories_rows,
    ),
    DataExportFile(
        "tax_advantaged_category_limits.csv",
        (
            "Tax-advantaged category",
            "Tax-advantaged category number",
            "Year",
            "Contribution limit",
            "Withdrawal limit",
            "Accrued contributions",
            "Accrued withdrawals",
        ),
        _tax_advantaged_category_limits_rows,
    ),
    DataExportFile("saved_insights_ranges.csv", ("Name", "Amount", "Unit", "Qualifier"), _saved_insights_ranges_rows),
    DataExportFile("bank_connections.csv", ("Provider", "Nickname", "Connected", "Last successful sync"), _bank_connections_rows),
    DataExportFile(
        "bank_links.csv",
        ("Account", "Account number", "Bank account name", "Institution", "State", "Linked", "Unlinked"),
        _bank_links_rows,
    ),
    DataExportFile(
        "bank_items.csv",
        (
            "Account",
            "Account number",
            "Date",
            "Amount",
            "Currency",
            "Description",
            "Merchant",
            "Note",
            "Review status",
            "Removed",
        ),
        _bank_items_rows,
    ),
    DataExportFile("imports.csv", ("Source", "File name", "Started", "Saved", "Transaction count"), _imports_rows),
)
