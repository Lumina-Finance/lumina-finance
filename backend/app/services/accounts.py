"""Account data enrichment helpers.

Helpers here run as part of the detail-shape endpoints (`GET /accounts/{id}`,
`POST /accounts`, `PATCH /accounts/{id}`) to attach derived fields to an
Account instance before Pydantic serializes it. They live outside the route
module so the SQL stays testable and the route handlers stay lean.
"""
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, TaxAdvantagedConfig
from app.models.base import CategoryKind, TaxTreatment
from app.models.category import Category
from app.models.transaction import Transaction


async def attach_tax_advantaged_tallies(db: AsyncSession, accounts: Sequence[Account]) -> None:
    """Set ytd/lifetime contribution and withdrawal tallies on each account in place.

    Sources the tallies from transfer-kind transactions (``Category.kind == TRANSFER``)
    on the account: positive amounts sum into contributions, negative amounts sum
    (absolute) into withdrawals. YTD uses the current UTC calendar year.

    Gating, applied per-account in Python:
    - ``tax_treatment == TAXABLE`` — all four fields set to None, no SQL issued.
    - Otherwise — YTD fields populated (zero if no activity).
    - Lifetime fields populated only when ``lifetime_contribution_limit`` is set; null otherwise.
    """
    if not accounts:
        return

    tax_advantaged = [a for a in accounts if a.tax_treatment != TaxTreatment.TAXABLE]

    tallies: dict[uuid.UUID, dict[str, int]] = {}
    if tax_advantaged:
        current_year = datetime.now(UTC).year
        year_start = datetime(current_year, 1, 1, tzinfo=UTC)
        year_end = datetime(current_year + 1, 1, 1, tzinfo=UTC)

        in_year = (Transaction.ts >= year_start) & (Transaction.ts < year_end)
        positive = Transaction.amount > 0
        negative = Transaction.amount < 0

        result = await db.execute(
            select(
                Transaction.account_id,
                func.coalesce(
                    func.sum(case((in_year & positive, Transaction.amount), else_=0)),
                    0,
                ).label("ytd_contributions"),
                func.coalesce(
                    func.sum(case((in_year & negative, -Transaction.amount), else_=0)),
                    0,
                ).label("ytd_withdrawals"),
                func.coalesce(
                    func.sum(case((positive, Transaction.amount), else_=0)),
                    0,
                ).label("lifetime_contributions"),
                func.coalesce(
                    func.sum(case((negative, -Transaction.amount), else_=0)),
                    0,
                ).label("lifetime_withdrawals"),
            )
            .join(Category, Transaction.category_id == Category.id)
            .where(
                Transaction.account_id.in_([a.id for a in tax_advantaged]),
                Category.kind == CategoryKind.TRANSFER,
            )
            .group_by(Transaction.account_id),
        )
        for row in result:
            tallies[row.account_id] = {
                "ytd_contributions": row.ytd_contributions,
                "ytd_withdrawals": row.ytd_withdrawals,
                "lifetime_contributions": row.lifetime_contributions,
                "lifetime_withdrawals": row.lifetime_withdrawals,
            }

    for account in accounts:
        if account.tax_treatment == TaxTreatment.TAXABLE:
            account.ytd_contributions = None
            account.ytd_withdrawals = None
            account.lifetime_contributions = None
            account.lifetime_withdrawals = None
            continue

        row = tallies.get(account.id)
        account.ytd_contributions = row["ytd_contributions"] if row else 0
        account.ytd_withdrawals = row["ytd_withdrawals"] if row else 0
        if account.lifetime_contribution_limit is not None:
            account.lifetime_contributions = row["lifetime_contributions"] if row else 0
            account.lifetime_withdrawals = row["lifetime_withdrawals"] if row else 0
        else:
            account.lifetime_contributions = None
            account.lifetime_withdrawals = None


async def attach_current_year_tax_limits(db: AsyncSession, accounts: Sequence[Account]) -> None:
    """Set current-year contribution/withdrawal limits on each account in place.

    Sources the limits from ``TaxAdvantagedConfig`` rows whose ``year`` matches
    the current UTC calendar year. Taxable accounts short-circuit to None without
    issuing SQL. For tax-advantaged accounts with no config row for the year,
    both fields are set to None.
    """
    if not accounts:
        return

    tax_advantaged = [a for a in accounts if a.tax_treatment != TaxTreatment.TAXABLE]

    limits: dict[uuid.UUID, tuple[int, int | None]] = {}
    if tax_advantaged:
        current_year = datetime.now(UTC).year
        result = await db.execute(
            select(
                TaxAdvantagedConfig.account_id,
                TaxAdvantagedConfig.contribution_limit,
                TaxAdvantagedConfig.withdrawal_limit,
            ).where(
                TaxAdvantagedConfig.account_id.in_([a.id for a in tax_advantaged]),
                TaxAdvantagedConfig.year == current_year,
            ),
        )
        for row in result:
            limits[row.account_id] = (row.contribution_limit, row.withdrawal_limit)

    for account in accounts:
        if account.tax_treatment == TaxTreatment.TAXABLE:
            account.current_year_contribution_limit = None
            account.current_year_withdrawal_limit = None
            continue

        row = limits.get(account.id)
        if row is None:
            account.current_year_contribution_limit = None
            account.current_year_withdrawal_limit = None
        else:
            account.current_year_contribution_limit = row[0]
            account.current_year_withdrawal_limit = row[1]
