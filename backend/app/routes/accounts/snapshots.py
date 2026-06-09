"""Account snapshot route handlers"""
import uuid
from datetime import date
from typing import Annotated, Literal

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import AccountBalanceSnapshot
from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.account import AccountBalanceSnapshotResponse

router = APIRouter()

SnapshotGranularity = Literal["day", "week", "month", "quarter"]


@router.get("/{account_id}/snapshots", response_model=list[AccountBalanceSnapshotResponse])
async def list_account_balance_snapshots(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    granularity: Annotated[SnapshotGranularity, Query()] = "day",
    include_anchor: Annotated[bool, Query()] = False,
):
    """Return account balance snapshots ordered by date

    Snapshots back the historical balance chart on the account detail page and
    feed the group net-worth aggregation

    When `granularity` is coarser than `day`, returns the latest snapshot in
    each bucket, which caps payload size for long ranges. When `include_anchor` is
    true and `from_date` is set, the latest snapshot before that date is
    prepended so the client can seed forward-fill at the start of the window

    Args:
        account_id: Account identifier from the route path
        user: Authenticated user requesting snapshots
        db: Active database session
        from_date: Optional inclusive lower date bound
        to_date: Optional inclusive upper date bound
        granularity: Snapshot grouping granularity
        include_anchor: Whether to prepend the latest snapshot before from_date

    Returns:
        Account balance snapshots ordered ascending by date

    Raises:
        HTTPException: User does not have read access or the date range is invalid
    """
    await check_account_access(db, account_id, user.id, PermissionLevel.READ)
    _raise_for_invalid_snapshot_date_bounds(from_date, to_date)

    snapshot_query = _build_account_snapshot_query(account_id, from_date, to_date)
    rows = await _get_account_snapshot_rows(db, snapshot_query, granularity)
    if include_anchor and from_date is not None:
        anchor = await _get_anchor_snapshot(db, account_id, from_date)
        if anchor is not None:
            rows.insert(0, anchor)
    return rows


def _raise_for_invalid_snapshot_date_bounds(from_date: date | None, to_date: date | None) -> None:
    """Raise when snapshot date bounds are inverted

    Args:
        from_date: Optional inclusive lower date bound
        to_date: Optional inclusive upper date bound

    Raises:
        HTTPException: Lower date bound is after upper date bound
    """
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Start date must be before end date",
        )


def _build_account_snapshot_query(
    account_id: uuid.UUID,
    from_date: date | None,
    to_date: date | None,
):
    """Build the filtered account snapshot query

    Args:
        account_id: Account identifier from the route path
        from_date: Optional inclusive lower date bound
        to_date: Optional inclusive upper date bound

    Returns:
        SQLAlchemy query selecting snapshots for the account and date bounds
    """
    query = select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id)
    if from_date is not None:
        query = query.where(AccountBalanceSnapshot.dt >= from_date)
    if to_date is not None:
        query = query.where(AccountBalanceSnapshot.dt <= to_date)
    return query


async def _get_account_snapshot_rows(
    db: AsyncSession,
    snapshot_query,
    granularity: SnapshotGranularity,
) -> list[AccountBalanceSnapshot]:
    """Return snapshot rows for a requested granularity

    Args:
        db: Active database session
        snapshot_query: Filtered account snapshot query
        granularity: Snapshot grouping granularity

    Returns:
        Account snapshot rows ordered ascending by date
    """
    if granularity == "day":
        query = snapshot_query.order_by(AccountBalanceSnapshot.dt)
        # Fetch every daily snapshot in the requested account and date range
        result = await db.execute(query)
        return list(result.scalars().all())

    bucket = sa.func.date_trunc(granularity, AccountBalanceSnapshot.dt)
    query = snapshot_query.distinct(bucket).order_by(bucket, AccountBalanceSnapshot.dt.desc())
    # Fetch one latest snapshot per requested week or month bucket
    result = await db.execute(query)
    return sorted(result.scalars().all(), key=lambda row: row.dt)


async def _get_anchor_snapshot(
    db: AsyncSession,
    account_id: uuid.UUID,
    from_date: date,
) -> AccountBalanceSnapshot | None:
    """Return the latest snapshot before a lower date bound

    Args:
        db: Active database session
        account_id: Account identifier from the route path
        from_date: Inclusive lower date bound for the main snapshot range

    Returns:
        Latest account snapshot before the lower date bound, if present
    """
    anchor_query = (
        select(AccountBalanceSnapshot)
        .where(
            AccountBalanceSnapshot.account_id == account_id,
            AccountBalanceSnapshot.dt < from_date,
        )
        .order_by(AccountBalanceSnapshot.dt.desc())
        .limit(1)
    )
    # Fetch the latest snapshot before the visible range to anchor chart continuity
    return (await db.execute(anchor_query)).scalar_one_or_none()
