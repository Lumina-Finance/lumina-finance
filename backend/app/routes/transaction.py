import uuid
from datetime import date, timedelta
from typing import Annotated, Literal

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import MappedColumn

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import Account, AccountPermission
from app.models.base import CategoryKind, PermissionLevel
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import GroupMember
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_account_access, check_transaction_access
from app.schemas.fx import FxStatus
from app.schemas.transaction import (
    CreateTransactionRequest,
    DailyCashFlow,
    OutlierTransaction,
    TopCategorySpend,
    TransactionImportRequest,
    TransactionImportResponse,
    TransactionResponse,
    TransactionsOverview,
    UpdateTransactionRequest,
)
from app.services.fx import FxConverter
from app.services.snapshots import recompute_snapshots_from
from app.services.transaction_imports import import_transactions
from app.services.transaction_responses import (
    build_transaction_response,
    get_merchant_names_batch,
    get_tag_ids,
    get_tag_ids_batch,
    get_tags_batch,
)

router = APIRouter(prefix="/transactions", tags=["transactions"])

_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"
OverviewCashFlowGranularity = Literal["day", "week", "month"]
_MONTHLY_RANGE_DAY_COUNT = 31
_HALF_YEAR_DAY_COUNT = 183

# Sortable fields mapped to their SQLAlchemy column objects
_SORT_FIELDS: dict[str, MappedColumn] = {
    "dt": Transaction.dt,
    "amount": Transaction.amount,
    "created_at": Transaction.created_at,
    "updated_at": Transaction.updated_at,
}

# Filter fields mapped to their SQLAlchemy column objects
_FILTER_FIELDS: dict[str, MappedColumn] = {
    "account_id": Transaction.account_id,
    "category_id": Transaction.category_id,
    "merchant_id": Transaction.merchant_id,
    "currency": Transaction.currency,
}


def _escape_like(value: str) -> str:
    """Escape LIKE-special characters so user input is matched literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _transaction_tag_sort_subquery():
    tag_name = sa.func.lower(Tag.name)
    return (
        select(
            TransactionTag.transaction_id,
            sa.func.string_agg(
                tag_name,
                aggregate_order_by(",", tag_name),
            ).label("tag_names"),
        )
        .join(Tag, Tag.id == TransactionTag.tag_id)
        .group_by(TransactionTag.transaction_id)
        .subquery()
    )


def _date_sort_order(sort_order: str, tag_names):
    date_order = Transaction.dt.desc() if sort_order == "desc" else Transaction.dt.asc()
    created_order = Transaction.created_at.desc() if sort_order == "desc" else Transaction.created_at.asc()
    return (
        date_order,
        created_order,
        Transaction.amount.asc(),
        sa.func.lower(Category.name).asc(),
        sa.func.lower(sa.func.coalesce(Merchant.name, "")).asc(),
        sa.func.lower(sa.func.coalesce(Transaction.notes, "")).asc(),
        sa.func.coalesce(tag_names, "").asc(),
        Transaction.id,
    )


def _accessible_account_ids(user_id: uuid.UUID):
    """Scalar subquery returning readable account IDs."""
    return (
        select(Account.id)
        .outerjoin(GroupMember, Account.group_id == GroupMember.group_id)
        .outerjoin(
            AccountPermission,
            (AccountPermission.account_id == Account.id) & (AccountPermission.user_id == user_id),
        )
        .where(
            (Account.owner_id == user_id)
            | ((GroupMember.user_id == user_id) & (GroupMember.is_admin.is_(True)))
            | (AccountPermission.user_id == user_id),
        )
    ).scalar_subquery()


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


async def _get_overview_accounts_by_id(db: AsyncSession, rows) -> dict[uuid.UUID, Account]:
    account_ids = {row.account_id for row in rows}
    accounts = (
        (await db.execute(select(Account).where(Account.id.in_(account_ids)))).scalars().all()
        if account_ids
        else []
    )
    return {account.id: account for account in accounts}


async def _get_overview_converter(
    db: AsyncSession,
    *,
    account_by_id: dict[uuid.UUID, Account],
    base_currency: str,
) -> FxConverter:
    return FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in account_by_id.values())},
        ),
    )


async def _prefetch_overview_rates(
    converter: FxConverter,
    *,
    rows,
    account_by_id: dict[uuid.UUID, Account],
    base_currency: str,
) -> None:
    if rows:
        start = min(row.date for row in rows)
        end = max(row.date for row in rows)
        for currency in sorted({
            account_by_id[row.account_id].currency
            for row in rows
            if account_by_id[row.account_id].currency != base_currency
        }):
            await converter.prefetch_rates(
                base=currency,
                quote=base_currency,
                start_date=start,
                end_date=end,
            )


def _fork_overview_converter(converter: FxConverter) -> FxConverter:
    fork = FxConverter(
        provider=converter.provider,
        currency_exponents=converter.currency_exponents,
    )
    fork.rates = converter.rates.copy()
    fork.failed_rates = converter.failed_rates.copy()
    return fork


def _get_overview_cash_flow_granularity(from_date: date, to_date: date) -> OverviewCashFlowGranularity:
    day_count = (to_date - from_date).days + 1
    if day_count <= _MONTHLY_RANGE_DAY_COUNT:
        return "day"
    if day_count <= _HALF_YEAR_DAY_COUNT:
        return "week"
    return "month"


def _overview_cash_flow_bucket_key(
    target: date,
    granularity: OverviewCashFlowGranularity,
) -> tuple[int, ...]:
    if granularity == "day":
        return (target.year, target.month, target.day)
    if granularity == "week":
        iso_year, iso_week, _weekday = target.isocalendar()
        return (iso_year, iso_week)
    return (target.year, target.month)


def _build_overview_cash_flow_buckets(from_date: date, to_date: date) -> list[tuple[date, date]]:
    granularity = _get_overview_cash_flow_granularity(from_date, to_date)
    buckets: list[tuple[date, date]] = []
    bucket_start = from_date
    current_key = _overview_cash_flow_bucket_key(from_date, granularity)
    cursor = from_date

    while cursor <= to_date:
        key = _overview_cash_flow_bucket_key(cursor, granularity)
        if key != current_key:
            buckets.append((bucket_start, cursor - timedelta(days=1)))
            bucket_start = cursor
            current_key = key
        cursor += timedelta(days=1)

    buckets.append((bucket_start, to_date))
    return buckets


def _bucket_overview_daily_cash_flow(
    daily_totals: dict[date, tuple[int, int]],
    *,
    from_date: date,
    to_date: date,
) -> list[DailyCashFlow]:
    daily_cash_flow: list[DailyCashFlow] = []
    for bucket_start, bucket_end in _build_overview_cash_flow_buckets(from_date, to_date):
        inflow = 0
        outflow = 0
        cursor = bucket_start
        while cursor <= bucket_end:
            day_inflow, day_outflow = daily_totals.get(cursor, (0, 0))
            inflow += day_inflow
            outflow += day_outflow
            cursor += timedelta(days=1)
        daily_cash_flow.append(DailyCashFlow(
            date=bucket_start,
            end_date=bucket_end,
            inflow=inflow,
            outflow=outflow,
        ))
    return daily_cash_flow


async def _convert_overview_daily_cash_flow(
    *,
    flow_rows,
    account_by_id: dict[uuid.UUID, Account],
    converter: FxConverter,
    base_currency: str,
    from_date: date | None,
    to_date: date | None,
) -> tuple[list[DailyCashFlow], FxStatus]:
    daily_totals: dict[date, tuple[int, int]] = {}
    for row in flow_rows:
        # Transaction.amount is stored in the account currency; Transaction.currency is receipt metadata.
        currency = account_by_id[row.account_id].currency
        row_inflow = int(row.inflow or 0)
        row_outflow = int(row.outflow or 0)
        converted_inflow = await converter.convert_minor_units(
            row_inflow,
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        converted_outflow = await converter.convert_minor_units(
            row_outflow,
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if (
            (row_inflow == 0 or converted_inflow is None)
            and (row_outflow == 0 or converted_outflow is None)
        ):
            continue
        inflow, outflow = daily_totals.get(row.date, (0, 0))
        daily_totals[row.date] = (
            inflow + (converted_inflow or 0),
            outflow + (converted_outflow or 0),
        )

    if not daily_totals:
        return [], converter.get_status()

    period_start = from_date or min(daily_totals)
    period_end = to_date or max(daily_totals)
    daily_cash_flow = _bucket_overview_daily_cash_flow(
        daily_totals,
        from_date=period_start,
        to_date=period_end,
    )
    return daily_cash_flow, converter.get_status()


def _sum_overview_net_flow(daily_cash_flow: list[DailyCashFlow]) -> tuple[int, int]:
    return (
        sum(day.inflow for day in daily_cash_flow),
        sum(day.outflow for day in daily_cash_flow),
    )


async def _convert_overview_outliers(
    *,
    category_rows,
    candidate_rows,
    account_by_id: dict[uuid.UUID, Account],
    converter: FxConverter,
    base_currency: str,
) -> tuple[list[OutlierTransaction], FxStatus]:
    category_totals: dict[uuid.UUID, int] = {}
    for row in category_rows:
        # Transaction.amount is stored in the account currency; Transaction.currency is receipt metadata.
        currency = account_by_id[row.account_id].currency
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue

        category_totals[row.category_id] = category_totals.get(row.category_id, 0) + converted_total

    remaining_by_category = {
        category_id: -total
        for category_id, total in category_totals.items()
        if total < 0
    }

    converted_candidates = []
    for row in candidate_rows:
        currency = account_by_id[row.account_id].currency
        converted_amount = await converter.convert_minor_units(
            int(row.amount),
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_amount is None or converted_amount >= 0:
            continue

        converted_candidates.append((row, converted_amount))

    outlier_candidates = []
    for row, converted_amount in sorted(converted_candidates, key=lambda item: item[1]):
        remaining = remaining_by_category.get(row.category_id, 0)
        if remaining <= 0:
            continue
        amount = -min(-converted_amount, remaining)
        remaining_by_category[row.category_id] = remaining + amount
        outlier_candidates.append(OutlierTransaction(
            id=row.id,
            merchant_name=row.merchant_name,
            notes=row.notes,
            amount=int(row.amount),
            currency=account_by_id[row.account_id].currency,
            dt=row.date,
        ))

    return outlier_candidates[:3], converter.get_status()


async def _convert_overview_top_categories(
    *,
    category_rows,
    account_by_id: dict[uuid.UUID, Account],
    converter: FxConverter,
    base_currency: str,
) -> tuple[list[TopCategorySpend], FxStatus]:
    category_totals: dict[uuid.UUID, tuple[str, int]] = {}
    for row in category_rows:
        # Transaction.amount is stored in the account currency; Transaction.currency is receipt metadata.
        currency = account_by_id[row.account_id].currency
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue

        name, current_total = category_totals.get(row.category_id, (row.category_name, 0))
        category_totals[row.category_id] = (name, current_total + converted_total)

    top_categories = [
        TopCategorySpend(category_id=category_id, category_name=name, total=total)
        for category_id, (name, total) in category_totals.items()
        if total < 0
    ]
    top_categories.sort(key=lambda category: category.total)
    return top_categories[:5], converter.get_status()


async def _check_category_access_or_422(
    db: AsyncSession, category_id: uuid.UUID, user_id: uuid.UUID, group_id: uuid.UUID | None = None,
) -> None:
    """Validate a category exists and is accessible for the account scope."""
    query = select(Category).where(Category.id == category_id)
    if group_id is not None:
        query = query.where(
            Category.is_system.is_(True)
            | ((Category.owner_id == user_id) & (Category.group_id.is_(None)))
            | (Category.group_id == group_id),
        )
    else:
        query = query.where(
            Category.is_system.is_(True)
            | ((Category.owner_id == user_id) & (Category.group_id.is_(None))),
        )
    if not (await db.execute(query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")


async def _check_merchant_access_or_422(
    db: AsyncSession, merchant_id: uuid.UUID, user_id: uuid.UUID, group_id: uuid.UUID | None = None,
) -> None:
    """Validate a merchant exists and is accessible (personal or same group)."""
    query = select(Merchant).where(Merchant.id == merchant_id)
    if group_id is not None:
        query = query.where(
            ((Merchant.owner_id == user_id) & (Merchant.group_id.is_(None))) | (Merchant.group_id == group_id),
        )
    else:
        query = query.where(Merchant.owner_id == user_id, Merchant.group_id.is_(None))
    if not (await db.execute(query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Merchant not found")


async def _validate_tag_ids(
    db: AsyncSession, user_id: uuid.UUID, tag_ids: list[uuid.UUID], group_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """Validate all tag IDs are accessible in the transaction account scope."""
    # Deduplicate to avoid inserting duplicate junction rows (composite PK violation)
    unique_ids = list(dict.fromkeys(tag_ids))
    tag_filter = (Tag.owner_id == user_id) & (Tag.group_id.is_(None))
    if group_id is not None:
        tag_filter = tag_filter | (Tag.group_id == group_id)

    result = await db.execute(
        select(Tag.id).where(Tag.id.in_(unique_ids), tag_filter),
    )
    found_ids = set(result.scalars().all())
    if found_ids != set(unique_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Tag not found")
    return unique_ids


async def _replace_tags(db: AsyncSession, transaction_id: uuid.UUID, tag_ids: list[uuid.UUID]) -> None:
    """Replace all tags on a transaction with the given tag IDs."""
    await db.execute(
        sa.delete(TransactionTag).where(TransactionTag.transaction_id == transaction_id),
    )
    for tag_id in tag_ids:
        db.add(TransactionTag(transaction_id=transaction_id, tag_id=tag_id))


@router.get("/overview", response_model=TransactionsOverview)
async def get_transactions_overview(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    account_id: Annotated[uuid.UUID | None, Query()] = None,
):
    """Aggregated transaction metrics for a date range."""
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Start date must be before end date")

    accessible = _accessible_account_ids(user.id)

    # Base filter shared by all aggregation queries
    base = select(Transaction).where(Transaction.account_id.in_(accessible))
    if account_id is not None:
        base = base.where(Transaction.account_id == account_id)
    if from_date is not None:
        base = base.where(Transaction.dt >= from_date)
    if to_date is not None:
        base = base.where(Transaction.dt <= to_date)

    base_where = base.whereclause

    # Short-circuit: if no transactions match, return all nulls
    exists_query = select(sa.literal(1)).where(base_where).limit(1)
    if (await db.execute(exists_query)).scalar_one_or_none() is None:
        return TransactionsOverview(
            total_inflow=None, total_outflow=None,
            top_categories=None, daily_cash_flow=None, outliers=None,
        )

    # Inflow / outflow totals
    flow_query = (
        select(
            Transaction.dt.label("date"),
            Transaction.account_id,
            sa.func.coalesce(sa.func.sum(sa.case((Transaction.amount > 0, Transaction.amount))), 0).label("inflow"),
            sa.func.coalesce(sa.func.sum(sa.case((Transaction.amount < 0, Transaction.amount))), 0).label("outflow"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(base_where)
        .where(
            sa.or_(
                Category.kind.in_([CategoryKind.EXPENSE, CategoryKind.INCOME]),
                (
                    (Category.kind == CategoryKind.TRANSFER)
                    & (Category.name != _BALANCE_ADJUSTMENT_CATEGORY_NAME)
                ),
            ),
        )
        .group_by(Transaction.dt, Transaction.account_id)
    )
    flow_rows = (await db.execute(flow_query)).all()

    # Top 5 expense-side categories by net category outflow.
    cat_query = (
        select(
            Transaction.category_id,
            Category.name.label("category_name"),
            Transaction.account_id,
            Transaction.dt.label("date"),
            sa.func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(base_where)
        .where(Category.kind.in_([CategoryKind.EXPENSE, CategoryKind.INCOME]))
        .group_by(Transaction.category_id, Category.name, Transaction.account_id, Transaction.dt)
    )
    cat_rows = (await db.execute(cat_query)).all()

    # Top 3 largest expense-side transaction contributors after category-level
    # refunds/income offsets have been netted for the selected period.
    outlier_query = (
        select(
            Transaction.id,
            Transaction.account_id,
            Merchant.name.label("merchant_name"),
            Transaction.notes,
            Transaction.amount,
            Transaction.dt.label("date"),
            Transaction.category_id,
        )
        .outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
        .join(Category, Transaction.category_id == Category.id)
        .where(base_where)
        .where(Category.kind.in_([CategoryKind.EXPENSE, CategoryKind.INCOME]))
        .where(Transaction.amount < 0)
        .order_by(Transaction.amount.asc())
    )
    outlier_rows = (await db.execute(outlier_query)).all()
    overview_fx_rows = [*flow_rows, *cat_rows, *outlier_rows]
    account_by_id = await _get_overview_accounts_by_id(db, overview_fx_rows)
    overview_converter = await _get_overview_converter(
        db,
        account_by_id=account_by_id,
        base_currency=user.base_currency,
    )
    await _prefetch_overview_rates(
        overview_converter,
        rows=overview_fx_rows,
        account_by_id=account_by_id,
        base_currency=user.base_currency,
    )
    top_categories, top_categories_fx_status = await _convert_overview_top_categories(
        category_rows=cat_rows,
        account_by_id=account_by_id,
        converter=_fork_overview_converter(overview_converter),
        base_currency=user.base_currency,
    )
    daily_cash_flow, daily_cash_flow_fx_status = await _convert_overview_daily_cash_flow(
        flow_rows=flow_rows,
        account_by_id=account_by_id,
        converter=_fork_overview_converter(overview_converter),
        base_currency=user.base_currency,
        from_date=from_date,
        to_date=to_date,
    )
    total_inflow, total_outflow = _sum_overview_net_flow(daily_cash_flow)
    outliers, outliers_fx_status = await _convert_overview_outliers(
        category_rows=cat_rows,
        candidate_rows=outlier_rows,
        account_by_id=account_by_id,
        converter=_fork_overview_converter(overview_converter),
        base_currency=user.base_currency,
    )

    return TransactionsOverview(
        total_inflow=total_inflow,
        total_outflow=total_outflow,
        net_flow_fx_status=daily_cash_flow_fx_status,
        top_categories=top_categories,
        top_categories_fx_status=top_categories_fx_status,
        daily_cash_flow=daily_cash_flow,
        daily_cash_flow_fx_status=daily_cash_flow_fx_status,
        outliers=outliers,
        outliers_fx_status=outliers_fx_status,
    )


@router.get("", response_model=list[TransactionResponse])
async def list_transactions(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    account_id: Annotated[uuid.UUID | None, Query()] = None,
    category_id: Annotated[uuid.UUID | None, Query()] = None,
    merchant_id: Annotated[uuid.UUID | None, Query()] = None,
    currency: Annotated[str | None, Query()] = None,
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    sort_by: Annotated[str, Query()] = "dt",
    sort_order: Annotated[str, Query()] = "desc",
    limit: Annotated[int, Query(ge=1, le=50)] = 15,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Return paginated transactions with sorting and filtering."""
    if sort_by not in _SORT_FIELDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid sort field")
    if sort_order not in ("asc", "desc"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Sort order must be 'asc' or 'desc'")
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Start date must be before end date")

    sort_column = _SORT_FIELDS[sort_by]

    accessible = _accessible_account_ids(user.id)
    query = select(Transaction).where(Transaction.account_id.in_(accessible))

    # Apply exact-match filters
    filters = {
        "account_id": account_id,
        "category_id": category_id,
        "merchant_id": merchant_id,
        "currency": currency,
    }
    for field, value in filters.items():
        if value is not None:
            query = query.where(_FILTER_FIELDS[field] == value)

    # Apply date range filters
    if from_date is not None:
        query = query.where(Transaction.dt >= from_date)
    if to_date is not None:
        query = query.where(Transaction.dt <= to_date)

    tag_sort = None
    merchant_joined = False
    if sort_by == "dt":
        tag_sort = _transaction_tag_sort_subquery()
        query = (
            query
            .join(Category, Category.id == Transaction.category_id)
            .outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
            .outerjoin(tag_sort, tag_sort.c.transaction_id == Transaction.id)
        )
        merchant_joined = True

    # Text search across merchant name and notes
    if q is not None:
        pattern = f"%{_escape_like(q)}%"
        if not merchant_joined:
            query = query.outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
        query = query.where(Transaction.notes.ilike(pattern) | Merchant.name.ilike(pattern))

    if sort_by == "dt":
        query = query.order_by(*_date_sort_order(sort_order, tag_sort.c.tag_names))
    else:
        # Secondary sort by id for deterministic pagination
        order = sort_column.desc() if sort_order == "desc" else sort_column.asc()
        query = query.order_by(order, Transaction.id)
    query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    transactions = result.scalars().all()

    tag_map = await get_tag_ids_batch(db, [txn.id for txn in transactions])
    tag_summary_map = await get_tags_batch(db, [txn.id for txn in transactions])
    merchant_names = await get_merchant_names_batch(db, [txn.merchant_id for txn in transactions])
    return [
        build_transaction_response(
            txn,
            tag_map[txn.id],
            merchant_names.get(txn.merchant_id) if txn.merchant_id else None,
            tag_summary_map[txn.id],
        )
        for txn in transactions
    ]


@router.get("/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single transaction by ID. Requires read access on the parent account."""
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.READ)
    tag_ids = await get_tag_ids(db, txn.id)
    tag_summary_map = await get_tags_batch(db, [txn.id])
    merchant_names = await get_merchant_names_batch(db, [txn.merchant_id])
    return build_transaction_response(
        txn,
        tag_ids,
        merchant_names.get(txn.merchant_id) if txn.merchant_id else None,
        tag_summary_map[txn.id],
    )


@router.post("/import", response_model=TransactionImportResponse, status_code=status.HTTP_201_CREATED)
async def import_transaction_batch(
    data: TransactionImportRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Import frontend-compiled transactions and rebuild affected account snapshots once."""
    return await import_transactions(db, user, data)


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: CreateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new transaction. Requires write access on the target account."""
    account = await check_account_access(
        db,
        data.account_id,
        user.id,
        PermissionLevel.WRITE,
        require_open=True,
    )
    if account.is_archived:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is archived")

    currency_lookup = await db.execute(select(Currency).where(Currency.id == data.currency))
    if not currency_lookup.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    if data.currency != account.currency and data.fx_rate is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="fx_rate is required when transaction currency differs from account currency",
        )

    await _check_category_access_or_422(db, data.category_id, user.id, account.group_id)
    if data.merchant_id:
        await _check_merchant_access_or_422(db, data.merchant_id, user.id, account.group_id)
    validated_tag_ids = []
    if data.tag_ids:
        validated_tag_ids = await _validate_tag_ids(db, user.id, data.tag_ids, account.group_id)

    txn = Transaction(
        created_by_user_id=user.id,
        account_id=data.account_id,
        dt=data.dt,
        merchant_id=data.merchant_id,
        category_id=data.category_id,
        amount=data.amount,
        currency=data.currency,
        fx_rate=data.fx_rate,
        notes=data.notes,
    )
    db.add(txn)
    await db.flush()

    if validated_tag_ids:
        await _replace_tags(db, txn.id, validated_tag_ids)

    # Rebuild balance snapshots from this transaction's day forward
    await recompute_snapshots_from(db, data.account_id, data.dt)

    await db.commit()
    await db.refresh(txn)

    tag_ids = await get_tag_ids(db, txn.id)
    tag_summary_map = await get_tags_batch(db, [txn.id])
    merchant_names = await get_merchant_names_batch(db, [txn.merchant_id])
    return build_transaction_response(
        txn,
        tag_ids,
        merchant_names.get(txn.merchant_id) if txn.merchant_id else None,
        tag_summary_map[txn.id],
    )


@router.patch("/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_id: uuid.UUID,
    data: UpdateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a transaction. Requires write access on the target account."""
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE)
    current_account = (await db.execute(select(Account).where(Account.id == txn.account_id))).scalar_one()
    if current_account.is_archived:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is archived")

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        tag_ids = await get_tag_ids(db, txn.id)
        tag_summary_map = await get_tags_batch(db, [txn.id])
        merchant_names = await get_merchant_names_batch(db, [txn.merchant_id])
        return build_transaction_response(
            txn,
            tag_ids,
            merchant_names.get(txn.merchant_id) if txn.merchant_id else None,
            tag_summary_map[txn.id],
        )

    # Capture pre-change values needed to recompute balance snapshots
    old_account_id = txn.account_id
    old_dt = txn.dt

    # Resolve the account's group_id for category/merchant validation
    account_group_id = None
    if "account_id" in changed_fields:
        # Moving to a new account requires a writable target that accepts new history.
        new_account = await check_account_access(
            db,
            changed_fields["account_id"],
            user.id,
            PermissionLevel.WRITE,
            require_open=True,
        )
        if new_account.is_archived:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is archived")
        account_group_id = new_account.group_id
        if txn.currency != new_account.currency and txn.fx_rate is None and "fx_rate" not in changed_fields:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="fx_rate is required when transaction currency differs from account currency",
            )
    else:
        account_group_id = current_account.group_id

    if "category_id" in changed_fields:
        await _check_category_access_or_422(db, changed_fields["category_id"], user.id, account_group_id)
    if "merchant_id" in changed_fields and changed_fields["merchant_id"] is not None:
        await _check_merchant_access_or_422(db, changed_fields["merchant_id"], user.id, account_group_id)

    # Snapshot recomputation is only needed when balance-affecting fields change
    recompute_needed = bool({"account_id", "dt", "amount"} & changed_fields.keys())

    # Handle tags separately — validate and replace in bulk
    new_tag_ids = changed_fields.pop("tag_ids", None)

    for field, value in changed_fields.items():
        setattr(txn, field, value)

    if new_tag_ids is not None:
        validated = await _validate_tag_ids(db, user.id, new_tag_ids, account_group_id) if new_tag_ids else []
        await _replace_tags(db, txn.id, validated)

    if recompute_needed:
        await db.flush()
        if txn.account_id != old_account_id:
            # Account moved — recompute both sides from their respective affected days
            await recompute_snapshots_from(db, old_account_id, old_dt)
            await recompute_snapshots_from(db, txn.account_id, txn.dt)
        else:
            # Same account — recompute from the earliest affected day
            await recompute_snapshots_from(db, txn.account_id, min(old_dt, txn.dt))

    await db.commit()
    await db.refresh(txn)

    tag_ids = await get_tag_ids(db, txn.id)
    tag_summary_map = await get_tags_batch(db, [txn.id])
    merchant_names = await get_merchant_names_batch(db, [txn.merchant_id])
    return build_transaction_response(
        txn,
        tag_ids,
        merchant_names.get(txn.merchant_id) if txn.merchant_id else None,
        tag_summary_map[txn.id],
    )


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a transaction. Requires write access on the parent account."""
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.WRITE)
    account = (await db.execute(select(Account).where(Account.id == txn.account_id))).scalar_one()
    if account.is_archived:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is archived")

    # Capture pre-delete values for snapshot recomputation
    account_id = txn.account_id
    deleted_dt = txn.dt

    # Delete junction rows before the transaction itself
    await db.execute(
        sa.delete(TransactionTag).where(TransactionTag.transaction_id == transaction_id),
    )
    await db.delete(txn)
    await db.flush()

    # Rebuild balance snapshots from this transaction's day forward
    await recompute_snapshots_from(db, account_id, deleted_dt)

    await db.commit()
