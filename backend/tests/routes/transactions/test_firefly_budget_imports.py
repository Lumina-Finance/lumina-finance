import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, timedelta

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

from app.database import current_user_id_ctx
from app.models.base import CategoryKind
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.cache_state import UserCacheState
from app.models.category import Category
from app.models.currency import Currency
from tests.conftest import ScopedSession, TestSession, scoped_engine
from tests.routes.base_budgets._helpers import (
    _create_base_budget,
    _create_category,
    _create_group,
    _create_second_user,
)
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _get_auth_header

# The cadence of a budget whose latest limit is one calendar month
MONTHLY_ON_THE_FIRST = {"freq": "monthly", "instance_length": 1, "weekday": None, "dom": 1, "month": None}


@dataclass(frozen=True)
class _BudgetFlushObservation:
    """Counts of pending budget rows at one observed flush"""

    ordinal: int
    base_budgets: int
    budgets: int
    tracked_categories: int


@dataclass(frozen=True)
class _BudgetImportObservations:
    """Immutable observations from one Firefly budget import request"""

    category_selects: int
    flushes: tuple[_BudgetFlushObservation, ...]
    commits: int
    fault_attempts: int = 0


@dataclass(frozen=True)
class _PersonalBudgetState:
    """Exact personal budget and cache rows visible through the application role"""

    base_budgets: tuple[tuple, ...]
    budgets: tuple[tuple, ...]
    tracked_categories: tuple[tuple, ...]
    cache_state: tuple | None


@contextmanager
def _observe_budget_import(fail_after: str | None = None) -> Iterator[Callable[[], _BudgetImportObservations]]:
    """Observe category reads and budget-bearing flushes for one app-role request"""
    if fail_after not in {None, "parents", "first-child-buffer"}:
        raise ValueError(f"Unsupported budget fault boundary: {fail_after}")
    category_selects = 0
    flushes: list[_BudgetFlushObservation] = []
    budget_session: Session | None = None
    commits = 0
    armed_session: Session | None = None
    fault_attempts = 0
    sync_session_class = ScopedSession.class_.sync_session_class

    def is_scoped_session(session: Session) -> bool:
        """Return whether a synchronous ORM event belongs to the app-role engine"""
        return session.get_bind() is scoped_engine.sync_engine

    def before_cursor_execute(
        _connection,
        _cursor,
        _statement,
        _parameters,
        context,
        _executemany,
    ) -> None:
        """Count compiled category SELECTs without retaining SQL or parameters"""
        nonlocal category_selects
        compiled = getattr(context, "compiled", None)
        statement = getattr(compiled, "statement", None)
        if isinstance(statement, Select) and any(
            from_clause.is_derived_from(Category.__table__)
            for from_clause in statement.get_final_froms()
        ):
            category_selects += 1

    def before_flush(session: Session, _flush_context, _instances) -> None:
        """Record pending budget model populations without changing the flush"""
        nonlocal armed_session, budget_session
        if not is_scoped_session(session):
            return
        base_budget_count = sum(isinstance(row, BaseBudget) for row in session.new)
        budget_count = sum(isinstance(row, Budget) for row in session.new)
        tracked_category_count = sum(isinstance(row, BudgetTrackedCategory) for row in session.new)
        if not (base_budget_count or budget_count or tracked_category_count):
            return
        if budget_session is None:
            budget_session = session
        assert session is budget_session, "budget-bearing flushes crossed request sessions"
        flushes.append(_BudgetFlushObservation(
            ordinal=len(flushes) + 1,
            base_budgets=base_budget_count,
            budgets=budget_count,
            tracked_categories=tracked_category_count,
        ))
        child_count = budget_count + tracked_category_count
        if fail_after == "parents" and base_budget_count and child_count == 0:
            armed_session = session
        elif fail_after == "first-child-buffer" and child_count == 1000:
            armed_session = session

    def after_flush(session: Session, _flush_context) -> None:
        """Abort the observed transaction after the selected real flush boundary"""
        nonlocal fault_attempts
        if session is not armed_session or fault_attempts:
            return
        fault_attempts += 1
        session.connection().exec_driver_sql("SELECT 1 / 0")

    def after_commit(session: Session) -> None:
        """Count commits only for the request session that flushed budget rows"""
        nonlocal commits
        if session is budget_session:
            commits += 1

    def snapshot() -> _BudgetImportObservations:
        """Freeze the counts collected so far"""
        return _BudgetImportObservations(category_selects, tuple(flushes), commits, fault_attempts)

    event.listen(scoped_engine.sync_engine, "before_cursor_execute", before_cursor_execute)
    event.listen(sync_session_class, "before_flush", before_flush)
    event.listen(sync_session_class, "after_flush", after_flush)
    event.listen(sync_session_class, "after_commit", after_commit)
    try:
        yield snapshot
    finally:
        event.remove(scoped_engine.sync_engine, "before_cursor_execute", before_cursor_execute)
        event.remove(sync_session_class, "before_flush", before_flush)
        event.remove(sync_session_class, "after_flush", after_flush)
        event.remove(sync_session_class, "after_commit", after_commit)


async def _get_category_id(client, headers, name):
    """Return the id of a visible category by name

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        name: Category name to find

    Returns:
        Category id string
    """
    resp = await client.get("/categories", headers=headers)
    return next(category["id"] for category in resp.json() if category["name"] == name)


async def _import_one_budget(client, headers, category_id, limits, name="Groceries", is_archived=None, recurrence=None):
    """Import one budget and return the created base budget and its instances

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        category_id: Tracked category for the budget
        limits: Limit periods for the import payload
        name: Budget name
        is_archived: Archived flag for the payload, omitted when None so the
            default is exercised
        recurrence: Cadence the frontend would send, None for not recurring

    Returns:
        Base budget response paired with its instance list
    """
    payload = {
        "name": name,
        "currency": "CAD",
        "category_ids": [category_id],
        "recurrence": recurrence,
        "limits": limits,
    }
    if is_archived is not None:
        payload["is_archived"] = is_archived

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [payload],
    }, headers=headers)
    assert resp.status_code == 201
    result = resp.json()["results"][0]

    base_resp = await client.get(f"/base-budgets/{result['base_budget_id']}", headers=headers)
    instances_resp = await client.get("/budgets", headers=headers)
    own = [b for b in instances_resp.json() if b["base_budget_id"] == result["base_budget_id"]]
    assert result["instance_count"] == len(own)
    return base_resp.json(), own


async def _read_personal_budget_rows(owner_id, base_budget_ids=None):
    """Read one user's imported budget rows through the application role"""
    identity_token = current_user_id_ctx.set(owner_id)
    try:
        async with ScopedSession() as session:

            # Read the imported parent and child rows under the owner's real RLS scope
            base_query = select(BaseBudget).where(BaseBudget.owner_id == owner_id)
            if base_budget_ids is not None:
                base_query = base_query.where(BaseBudget.id.in_(base_budget_ids))
            base_budgets = list((await session.execute(base_query)).scalars().all())
            found_ids = [base_budget.id for base_budget in base_budgets]
            if not found_ids:
                return base_budgets, [], []
            budgets = list((await session.execute(
                select(Budget).where(Budget.base_budget_id.in_(found_ids)),
            )).scalars().all())
            tracked_categories = list((await session.execute(
                select(BudgetTrackedCategory).where(
                    BudgetTrackedCategory.base_budget_id.in_(found_ids),
                ),
            )).scalars().all())
            return base_budgets, budgets, tracked_categories
    finally:
        current_user_id_ctx.reset(identity_token)


async def _snapshot_personal_budget_state(owner_id) -> _PersonalBudgetState:
    """Return an exact immutable snapshot of one user's budget and cache rows"""
    identity_token = current_user_id_ctx.set(owner_id)
    try:
        async with ScopedSession() as session:

            # Read all personal budget and cache rows under the user's real RLS scope
            base_budgets = list((await session.execute(
                select(BaseBudget).where(BaseBudget.owner_id == owner_id),
            )).scalars().all())
            base_budget_ids = [base_budget.id for base_budget in base_budgets]
            budgets = list((await session.execute(
                select(Budget).where(Budget.base_budget_id.in_(base_budget_ids)),
            )).scalars().all()) if base_budget_ids else []
            tracked_categories = list((await session.execute(
                select(BudgetTrackedCategory).where(
                    BudgetTrackedCategory.base_budget_id.in_(base_budget_ids),
                ),
            )).scalars().all()) if base_budget_ids else []
            cache_state = await session.get(UserCacheState, owner_id)
    finally:
        current_user_id_ctx.reset(identity_token)

    return _PersonalBudgetState(
        base_budgets=tuple(sorted((
            base_budget.id,
            base_budget.owner_id,
            base_budget.group_id,
            base_budget.name,
            base_budget.currency,
            base_budget.recurrence_freq,
            base_budget.instance_length,
            base_budget.recurrence_weekday,
            base_budget.recurrence_dom,
            base_budget.recurrence_month,
            base_budget.recurs,
            base_budget.is_archived,
        ) for base_budget in base_budgets)),
        budgets=tuple(sorted((
            budget.id,
            budget.base_budget_id,
            budget.period_start,
            budget.period_end,
            budget.overall_limit,
        ) for budget in budgets)),
        tracked_categories=tuple(sorted((
            link.id,
            link.base_budget_id,
            link.category_id,
            link.added_at,
            link.removed_at,
        ) for link in tracked_categories)),
        cache_state=(
            cache_state.user_id,
            cache_state.changed_at,
            cache_state.last_changed_session_id,
        ) if cache_state else None,
    )


def _daily_budget_limits(count: int) -> list[dict[str, str]]:
    """Return consecutive one-day limit payloads for child-buffer coverage"""
    first_day = date(2023, 1, 1)
    return [
        {
            "start": (first_day + timedelta(days=offset)).isoformat(),
            "end": (first_day + timedelta(days=offset)).isoformat(),
            "amount": f"{100 + offset}.00",
        }
        for offset in range(count)
    ]


async def _assert_compact_budget_import(client, record_property):
    """Run and fully verify the compact observed budget import"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_resp = await client.get("/test/me", headers=headers)
    owner_id = uuid.UUID(user_resp.json()["id"])
    groceries_id = await _get_category_id(client, headers, "Groceries")
    dining_id = await _get_category_id(client, headers, "Dining")
    other_signup = await client.post("/auth/signup", json={
        **SIGNUP_PAYLOAD,
        "email": "other@example.com",
    })
    assert other_signup.status_code == 201
    other_headers = _get_auth_header(other_signup)

    budget_names = [f"Observed budget {index}" for index in range(8)]
    payload = {
        "budgets": [
            {
                "name": name,
                "currency": "CAD",
                "category_ids": [groceries_id, dining_id],
                "recurrence": None,
                "limits": [
                    {
                        "start": "2025-01-01",
                        "end": "2025-01-31",
                        "amount": f"{100 + index}.25",
                    },
                    {
                        "start": "2025-02-01",
                        "end": "2025-02-28",
                        "amount": f"{200 + index}.50",
                    },
                ],
            }
            for index, name in enumerate(budget_names)
        ],
    }

    with _observe_budget_import() as get_observations:
        response = await client.post(
            "/transactions/import/firefly/budgets",
            json=payload,
            headers=headers,
        )
    observations = get_observations()

    assert response.status_code == 201
    body = response.json()
    assert body["budgets_created"] == 8
    assert [result["name"] for result in body["results"]] == budget_names
    assert [result["instance_count"] for result in body["results"]] == [2] * 8
    base_budget_ids = [uuid.UUID(result["base_budget_id"]) for result in body["results"]]
    assert len(set(base_budget_ids)) == 8
    assert observations.category_selects > 0, observations
    assert observations.flushes, observations
    assert observations.commits == 1, observations
    record_property("category_selects", observations.category_selects)
    record_property("budget_flushes", [vars(flush) for flush in observations.flushes])
    record_property("budget_commits", observations.commits)

    identity_token = current_user_id_ctx.set(owner_id)
    try:
        async with ScopedSession() as session:

            # Read the compact import under the owner's real RLS scope for exact stored assertions
            base_budgets = list((await session.execute(
                select(BaseBudget).where(BaseBudget.id.in_(base_budget_ids)),
            )).scalars().all())
            budgets = list((await session.execute(
                select(Budget).where(Budget.base_budget_id.in_(base_budget_ids)),
            )).scalars().all())
            tracked_categories = list((await session.execute(
                select(BudgetTrackedCategory).where(
                    BudgetTrackedCategory.base_budget_id.in_(base_budget_ids),
                    BudgetTrackedCategory.removed_at.is_(None),
                ),
            )).scalars().all())
    finally:
        current_user_id_ctx.reset(identity_token)

    assert {base_budget.id for base_budget in base_budgets} == set(base_budget_ids)
    assert {base_budget.owner_id for base_budget in base_budgets} == {owner_id}
    assert {base_budget.group_id for base_budget in base_budgets} == {None}
    assert {base_budget.name for base_budget in base_budgets} == set(budget_names)
    assert len(budgets) == 16
    expected_periods = {
        (
            base_budget_ids[index],
            "2025-01-01",
            "2025-01-31",
            (100 + index) * 100 + 25,
        )
        for index in range(8)
    } | {
        (
            base_budget_ids[index],
            "2025-02-01",
            "2025-02-28",
            (200 + index) * 100 + 50,
        )
        for index in range(8)
    }
    assert {
        (
            budget.base_budget_id,
            budget.period_start.isoformat(),
            budget.period_end.isoformat(),
            budget.overall_limit,
        )
        for budget in budgets
    } == expected_periods

    expected_category_ids = {uuid.UUID(groceries_id), uuid.UUID(dining_id)}
    assert len(tracked_categories) == 16
    for base_budget_id in base_budget_ids:
        own_links = [
            link for link in tracked_categories
            if link.base_budget_id == base_budget_id
        ]
        assert {link.category_id for link in own_links} == expected_category_ids
        assert {link.added_at.isoformat() for link in own_links} == {"2025-01-01"}

    assert get_observations() == observations
    hidden_base = await client.get(f"/base-budgets/{base_budget_ids[0]}", headers=other_headers)
    hidden_budget = await client.get(f"/budgets/{budgets[0].id}", headers=other_headers)
    assert hidden_base.status_code == 404
    assert hidden_budget.status_code == 404
    assert get_observations() == observations
    return observations


async def test_firefly_budget_import_batches_shared_category_lookup(client, record_property):
    """Shared categories need one lookup without changing imported budgets or isolation"""
    observations = await _assert_compact_budget_import(client, record_property)
    assert observations.category_selects == 1, observations


async def test_firefly_budget_import_batches_budget_flushes(client, record_property):
    """Observe budget flush populations without changing the complete imported result"""
    observations = await _assert_compact_budget_import(client, record_property)
    assert observations.flushes, observations
    assert observations.commits == 1, observations
    assert observations.flushes == (
        _BudgetFlushObservation(ordinal=1, base_budgets=8, budgets=0, tracked_categories=0),
        _BudgetFlushObservation(ordinal=2, base_budgets=0, budgets=16, tracked_categories=16),
    ), observations


async def test_firefly_budget_import_chunks_distinct_category_union(client):
    """More than 1,000 distinct requested categories use bounded reads and keep memberships"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    owner_id = uuid.UUID((await client.get("/test/me", headers=headers)).json()["id"])
    async with TestSession() as session:
        categories = [
            Category(
                owner_id=owner_id,
                group_id=None,
                name=f"Chunk category {index}",
                kind=CategoryKind.EXPENSE,
            )
            for index in range(1001)
        ]
        session.add_all(categories)
        await session.flush()
        category_ids = sorted((category.id for category in categories), key=lambda category_id: category_id.int)
        await session.commit()

    payload = {
        "budgets": [
            {
                "name": "First category chunk",
                "currency": "CAD",
                "category_ids": [str(category_id) for category_id in category_ids[:1000]],
                "recurrence": None,
                "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.000000000000"}],
            },
            {
                "name": "Second category chunk",
                "currency": "CAD",
                "category_ids": [str(category_ids[-1]), str(category_ids[0]), str(category_ids[0])],
                "recurrence": None,
                "limits": [{"start": "2025-02-01", "end": "2025-02-28", "amount": "200.000000000000"}],
            },
        ],
    }
    with _observe_budget_import() as get_observations:
        response = await client.post(
            "/transactions/import/firefly/budgets",
            json=payload,
            headers=headers,
        )
    observations = get_observations()

    assert response.status_code == 201
    results = response.json()["results"]
    assert [result["name"] for result in results] == ["First category chunk", "Second category chunk"]
    assert len({result["base_budget_id"] for result in results}) == 2
    assert observations.category_selects == 2, observations
    base_budget_ids = [uuid.UUID(result["base_budget_id"]) for result in results]
    _, budgets, tracked_categories = await _read_personal_budget_rows(owner_id, base_budget_ids)
    assert len(budgets) == 2
    links_by_budget = {
        base_budget_id: {
            link.category_id
            for link in tracked_categories
            if link.base_budget_id == base_budget_id and link.removed_at is None
        }
        for base_budget_id in base_budget_ids
    }
    assert links_by_budget[base_budget_ids[0]] == set(category_ids[:1000])
    assert links_by_budget[base_budget_ids[1]] == {category_ids[-1], category_ids[0]}


async def test_firefly_budget_import_accepts_system_and_own_categories_with_duplicates(client):
    """Personal imports accept system and own categories and de-duplicate each membership"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    owner_id = uuid.UUID((await client.get("/test/me", headers=headers)).json()["id"])
    system_category_id = await _get_category_id(client, headers, "Groceries")
    personal_category_id = await _create_category(client, headers, name="Personal groceries")

    response = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Mixed category scope",
            "currency": "CAD",
            "category_ids": [
                system_category_id,
                personal_category_id,
                system_category_id,
                personal_category_id,
            ],
            "recurrence": None,
            "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.000000000000"}],
        }],
    }, headers=headers)

    assert response.status_code == 201
    base_budget_id = uuid.UUID(response.json()["results"][0]["base_budget_id"])
    _, _, tracked_categories = await _read_personal_budget_rows(owner_id, [base_budget_id])
    assert len(tracked_categories) == 2
    assert {link.category_id for link in tracked_categories} == {
        uuid.UUID(system_category_id),
        uuid.UUID(personal_category_id),
    }


async def test_firefly_budget_import_conceals_forbidden_categories_without_writes(client):
    """Missing, other-personal and visible group categories share one refusal and create nothing"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    owner_id = uuid.UUID((await client.get("/test/me", headers=headers)).json()["id"])
    other_headers, _ = await _create_second_user(client)
    other_personal_id = await _create_category(client, other_headers, name="Other personal")
    group_id = await _create_group(client, headers, name="Visible group")
    group_category_id = await _create_category(client, headers, name="Visible group category", group_id=group_id)
    forbidden_ids = [
        "00000000-0000-0000-0000-000000000000",
        other_personal_id,
        group_category_id,
    ]

    for index, category_id in enumerate(forbidden_ids):
        response = await client.post("/transactions/import/firefly/budgets", json={
            "budgets": [{
                "name": f"Forbidden category {index}",
                "currency": "CAD",
                "category_ids": [category_id],
                "recurrence": None,
                "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.000000000000"}],
            }],
        }, headers=headers)
        assert response.status_code == 422
        assert response.json()["detail"] == f"Forbidden category {index}: a tracked category was not found"

    base_budgets, budgets, tracked_categories = await _read_personal_budget_rows(owner_id)
    assert base_budgets == []
    assert budgets == []
    assert tracked_categories == []


async def test_firefly_budget_import_preserves_budget_validation_order(client):
    """Union discovery leaves category and amount errors in request and budget-local order"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    valid_category_id = await _get_category_id(client, headers, "Groceries")
    missing_category_id = "00000000-0000-0000-0000-000000000000"

    malformed_budget = {
        "name": "Malformed first",
        "currency": "CAD",
        "category_ids": [valid_category_id],
        "recurrence": None,
        "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "not-a-number"}],
    }
    missing_category_budget = {
        "name": "Missing category",
        "currency": "CAD",
        "category_ids": [missing_category_id],
        "recurrence": None,
        "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.000000000000"}],
    }

    malformed_first = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [malformed_budget, missing_category_budget],
    }, headers=headers)
    assert malformed_first.status_code == 422
    assert malformed_first.json()["detail"] == 'Malformed first: invalid limit amount "not-a-number"'

    missing_first = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [missing_category_budget, malformed_budget],
    }, headers=headers)
    assert missing_first.status_code == 422
    assert missing_first.json()["detail"] == "Missing category: a tracked category was not found"

    same_budget = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            **malformed_budget,
            "category_ids": [missing_category_id],
        }],
    }, headers=headers)
    assert same_budget.status_code == 422
    assert same_budget.json()["detail"] == "Malformed first: a tracked category was not found"


async def test_firefly_budget_import_validates_currencies_before_budgets(client):
    """Currencies are checked for every budget first, and the error names the first budget in an unsupported one"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    valid_category_id = await _get_category_id(client, headers, "Groceries")
    response = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [
            {
                "name": "Malformed CAD",
                "currency": "CAD",
                "category_ids": [valid_category_id],
                "recurrence": None,
                "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "not-a-number"}],
            },
            {
                "name": "Missing ZZZ",
                "currency": "ZZZ",
                "category_ids": [valid_category_id],
                "recurrence": None,
                "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.000000000000"}],
            },
            {
                "name": "Missing AAA",
                "currency": "AAA",
                "category_ids": [valid_category_id],
                "recurrence": None,
                "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.000000000000"}],
            },
        ],
    }, headers=headers)

    assert response.status_code == 422
    assert response.json()["detail"] == "Missing ZZZ: currency ZZZ is not supported"


async def test_firefly_budget_import_bounds_pending_children(client):
    """Child flushes stay within 1,000 objects and preserve all period attachments"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    owner_id = uuid.UUID((await client.get("/test/me", headers=headers)).json()["id"])
    category_id = await _get_category_id(client, headers, "Groceries")
    limits = _daily_budget_limits(1000)

    with _observe_budget_import() as get_observations:
        response = await client.post("/transactions/import/firefly/budgets", json={
            "budgets": [{
                "name": "Bounded history",
                "currency": "CAD",
                "category_ids": [category_id],
                "recurrence": None,
                "limits": limits,
            }],
        }, headers=headers)
    observations = get_observations()

    assert response.status_code == 201
    result = response.json()["results"][0]
    assert result["instance_count"] == 1000
    child_flushes = [
        flush for flush in observations.flushes
        if flush.budgets or flush.tracked_categories
    ]
    assert child_flushes, observations
    assert max(flush.budgets + flush.tracked_categories for flush in child_flushes) <= 1000
    assert any(flush.budgets + flush.tracked_categories == 1000 for flush in child_flushes)
    assert sorted(flush.budgets + flush.tracked_categories for flush in child_flushes) == [1, 1000]
    assert sum(flush.budgets for flush in child_flushes) == 1000
    assert sum(flush.tracked_categories for flush in child_flushes) == 1

    base_budget_id = uuid.UUID(result["base_budget_id"])
    _, budgets, tracked_categories = await _read_personal_budget_rows(owner_id, [base_budget_id])
    assert len(budgets) == 1000
    assert len(tracked_categories) == 1
    assert tracked_categories[0].base_budget_id == base_budget_id
    assert tracked_categories[0].category_id == uuid.UUID(category_id)
    expected_periods = {
        (limit["start"], limit["end"], (100 + offset) * 100)
        for offset, limit in enumerate(limits)
    }
    assert {
        (budget.period_start.isoformat(), budget.period_end.isoformat(), budget.overall_limit)
        for budget in budgets
    } == expected_periods


async def test_firefly_budget_import_keeps_duplicate_definitions_independent(client):
    """Identical definitions create distinct parents with independent children"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    owner_id = uuid.UUID((await client.get("/test/me", headers=headers)).json()["id"])
    category_id = await _get_category_id(client, headers, "Groceries")
    budget_payload = {
        "name": "  Repeated budget  ",
        "currency": "CAD",
        "category_ids": [category_id, category_id],
        "recurrence": None,
        "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "321.000000000000"}],
    }
    response = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [budget_payload, budget_payload],
    }, headers=headers)

    assert response.status_code == 201
    results = response.json()["results"]
    assert [result["name"] for result in results] == ["Repeated budget", "Repeated budget"]
    base_budget_ids = [uuid.UUID(result["base_budget_id"]) for result in results]
    assert len(set(base_budget_ids)) == 2
    _, budgets, tracked_categories = await _read_personal_budget_rows(owner_id, base_budget_ids)
    assert len(budgets) == 2
    assert len(tracked_categories) == 2
    for base_budget_id in base_budget_ids:
        own_budgets = [budget for budget in budgets if budget.base_budget_id == base_budget_id]
        own_links = [link for link in tracked_categories if link.base_budget_id == base_budget_id]
        assert len(own_budgets) == 1
        assert own_budgets[0].period_start == date(2025, 1, 1)
        assert own_budgets[0].period_end == date(2025, 1, 31)
        assert own_budgets[0].overall_limit == 32100
        assert len(own_links) == 1
        assert own_links[0].category_id == uuid.UUID(category_id)
        assert own_links[0].added_at == date(2025, 1, 1)
        assert own_links[0].removed_at is None


@pytest.mark.parametrize(("currency", "amount", "expected"), [
    ("CAD", "650.500000000000", 65050),
    ("JPY", "650.000000000000", 650),
    ("BHD", "650.125000000000", 650125),
])
async def test_firefly_budget_import_preserves_currency_precision(client, currency, amount, expected):
    """Budget batching preserves accepted extra zeros and configured currency precision"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    owner_id = uuid.UUID((await client.get("/test/me", headers=headers)).json()["id"])
    if currency != "CAD":
        async with TestSession() as session:

            # Seed the real currency metadata used by the import amount parser
            session.add(Currency(
                id=currency,
                name=f"{currency} test currency",
                symbol=currency,
                minor_unit_exponent=0 if currency == "JPY" else 3,
            ))
            await session.commit()
    category_id = await _get_category_id(client, headers, "Groceries")
    response = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": f"{currency} precision",
            "currency": currency,
            "category_ids": [category_id],
            "recurrence": None,
            "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": amount}],
        }],
    }, headers=headers)

    assert response.status_code == 201
    base_budget_id = uuid.UUID(response.json()["results"][0]["base_budget_id"])
    _, budgets, _ = await _read_personal_budget_rows(owner_id, [base_budget_id])
    assert len(budgets) == 1
    assert budgets[0].overall_limit == expected


@pytest.mark.parametrize(("amount", "detail"), [
    ("12.345", 'Invalid amount: invalid limit amount "12.345"'),
    ("100.555000000000", 'Invalid amount: invalid limit amount "100.555000000000"'),
    ("0.000000000000", "Invalid amount: limit amounts must be positive"),
    ("not-a-number", 'Invalid amount: invalid limit amount "not-a-number"'),
    ("92233720368547758.08", 'Invalid amount: invalid limit amount "92233720368547758.08"'),
    ("0.00", "Invalid amount: limit amounts must be positive"),
    ("-1.00", "Invalid amount: limit amounts must be positive"),
])
async def test_firefly_budget_import_preserves_limit_refusals(client, amount, detail):
    """Budget batching preserves precision, syntax, range and positive-limit refusals"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    category_id = await _get_category_id(client, headers, "Groceries")
    response = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Invalid amount",
            "currency": "CAD",
            "category_ids": [category_id],
            "recurrence": None,
            "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": amount}],
        }],
    }, headers=headers)

    assert response.status_code == 422
    assert response.json()["detail"] == detail


@pytest.mark.parametrize(("invalid_kind", "expected_detail"), [
    ("amount", 'Late invalid: invalid limit amount "not-a-number"'),
    ("category", "Late invalid: a tracked category was not found"),
    ("overlap", "Late invalid: two limit periods overlap"),
])
async def test_firefly_budget_import_rejections_preserve_existing_state(client, invalid_kind, expected_detail):
    """Late validation refusals occur before writes and preserve existing rows and cache"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    owner_id = uuid.UUID((await client.get("/test/me", headers=headers)).json()["id"])
    category_id = await _create_category(client, headers, name="Existing tracked category")
    existing = await _create_base_budget(
        client,
        headers,
        name="Existing budget",
        category_ids=[category_id],
        period_start="2026-09-01",
        overall_limit=50000,
    )
    assert existing.status_code == 201
    before = await _snapshot_personal_budget_state(owner_id)
    assert len(before.base_budgets) == 1
    assert before.budgets
    assert len(before.tracked_categories) == 1
    assert before.cache_state is not None

    invalid_budget = {
        "name": "Late invalid",
        "currency": "CAD",
        "category_ids": [category_id],
        "recurrence": None,
        "limits": [{"start": "2025-02-01", "end": "2025-02-28", "amount": "100.000000000000"}],
    }
    if invalid_kind == "amount":
        invalid_budget["limits"][0]["amount"] = "not-a-number"
    elif invalid_kind == "category":
        invalid_budget["category_ids"] = ["00000000-0000-0000-0000-000000000000"]
    else:
        invalid_budget["limits"].append({
            "start": "2025-02-15",
            "end": "2025-03-14",
            "amount": "100.000000000000",
        })
    response = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [
            {
                "name": "Would be valid",
                "currency": "CAD",
                "category_ids": [category_id],
                "recurrence": None,
                "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.000000000000"}],
            },
            invalid_budget,
        ],
    }, headers=headers)

    assert response.status_code == 422
    assert response.json()["detail"] == expected_detail
    assert await _snapshot_personal_budget_state(owner_id) == before


@pytest.mark.parametrize("fault_boundary", ["parents", "first-child-buffer"])
async def test_firefly_budget_import_rolls_back_database_failures(client, fault_boundary):
    """A real post-flush database failure rolls back new rows and preserves existing state"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    owner_id = uuid.UUID((await client.get("/test/me", headers=headers)).json()["id"])
    category_id = await _create_category(client, headers, name="Rollback tracked category")
    existing = await _create_base_budget(
        client,
        headers,
        name="Rollback existing budget",
        category_ids=[category_id],
        period_start="2026-09-01",
        overall_limit=50000,
    )
    assert existing.status_code == 201
    before = await _snapshot_personal_budget_state(owner_id)
    assert len(before.base_budgets) == 1
    assert before.budgets
    assert len(before.tracked_categories) == 1
    assert before.cache_state is not None
    limits = _daily_budget_limits(1000) if fault_boundary == "first-child-buffer" else [
        {"start": "2025-01-01", "end": "2025-01-31", "amount": "100.000000000000"},
    ]
    payload = {
        "budgets": [{
            "name": f"Faulted import {fault_boundary}",
            "currency": "CAD",
            "category_ids": [category_id],
            "recurrence": None,
            "limits": limits,
        }],
    }

    with _observe_budget_import(fail_after=fault_boundary) as get_observations:
        with pytest.raises(DBAPIError):
            await client.post(
                "/transactions/import/firefly/budgets",
                json=payload,
                headers=headers,
            )
    observations = get_observations()

    assert observations.fault_attempts == 1, observations
    assert observations.commits == 0, observations
    if fault_boundary == "parents":
        assert any(
            flush.base_budgets == 1 and flush.budgets == 0 and flush.tracked_categories == 0
            for flush in observations.flushes
        ), observations
    else:
        assert any(
            flush.budgets + flush.tracked_categories == 1000
            for flush in observations.flushes
        ), observations

    # Both injected faults precede the cache upsert, so this proves preservation of its prior value
    assert await _snapshot_personal_budget_state(owner_id) == before


async def test_firefly_budget_import_mirrors_limit_periods(client):
    """Each limit period becomes one instance, and gaps stay gaps"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2025-01-01", "end": "2025-01-31", "amount": "600.000000000000"},
        {"start": "2025-03-01", "end": "2025-03-31", "amount": "650.500000000000"},
    ], recurrence=MONTHLY_ON_THE_FIRST)

    assert base["currency"] == "CAD"
    assert base["recurrence_freq"] == "monthly"
    assert base["instance_length"] == 1
    assert base["recurrence_dom"] == 1
    assert base["recurs"] is True
    assert base["category_ids"] == [groceries_id]

    # is_archived is omitted from the payload, so the budget imports active
    assert base["is_archived"] is False

    # February carried no limit and today's month never did, so neither gets
    # an instance and the history ends where the export ends
    periods = {(b["period_start"], b["period_end"]): b["overall_limit"] for b in own}
    assert periods == {
        ("2025-01-01", "2025-01-31"): 60000,
        ("2025-03-01", "2025-03-31"): 65050,
    }


async def test_firefly_budget_import_carries_archived_flag(client):
    """An archived Firefly budget imports archived with its full period history"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2025-01-01", "end": "2025-01-31", "amount": "600.000000000000"},
        {"start": "2025-02-01", "end": "2025-02-28", "amount": "620.000000000000"},
    ], is_archived=True)

    assert base["is_archived"] is True
    periods = {(b["period_start"], b["period_end"]): b["overall_limit"] for b in own}
    assert periods == {
        ("2025-01-01", "2025-01-31"): 60000,
        ("2025-02-01", "2025-02-28"): 62000,
    }


def _monthly_limits(*months):
    """Return one Firefly-format limit for each calendar month of 2026 given"""
    return [
        {
            "start": f"2026-{month:02d}-01",
            "end": (date(2026, month + 1, 1) - timedelta(days=1)).isoformat(),
            "amount": "500.000000000000",
        }
        for month in months
    ]


# The browser reads these cadences off the latest limit period, and
# frontend/tests/pages/imports/firefly/utils/budgets.test.ts expects the same ones from the same
# limits, so this shows the endpoint stores every cadence the preview can send
@pytest.mark.parametrize(("limits", "recurrence"), [
    pytest.param(
        [
            {"start": "2025-12-01", "end": "2025-12-31", "amount": "140.000000000000"},
            {"start": "2026-01-01", "end": "2026-03-31", "amount": "420.000000000000"},
        ],
        {"freq": "monthly", "instance_length": 3, "weekday": None, "dom": 1, "month": None},
        id="quarterly after monthly",
    ),
    pytest.param(
        [
            {"start": "2024-01-01", "end": "2024-12-31", "amount": "540.000000000000"},
            {"start": "2025-01-01", "end": "2025-12-31", "amount": "560.000000000000"},
        ],
        {"freq": "yearly", "instance_length": 1, "weekday": None, "dom": 1, "month": 1},
        id="yearly",
    ),
    pytest.param(
        [
            {"start": "2026-01-05", "end": "2026-01-11", "amount": "40.000000000000"},
            {"start": "2026-01-12", "end": "2026-01-18", "amount": "42.000000000000"},
        ],
        {"freq": "weekly", "instance_length": 1, "weekday": 0, "dom": None, "month": None},
        id="weekly from Monday",
    ),
    pytest.param(
        [{"start": "2026-01-15", "end": "2026-02-14", "amount": "100.000000000000"}],
        {"freq": "monthly", "instance_length": 1, "weekday": None, "dom": 15, "month": None},
        id="mid-month anchor",
    ),
    pytest.param(
        [{"start": "2026-02-28", "end": "2026-03-30", "amount": "100.000000000000"}],
        {"freq": "monthly", "instance_length": 1, "weekday": None, "dom": 31, "month": None},
        id="day-31 anchor capped in February",
    ),
    pytest.param(
        [{"start": "2025-11-30", "end": "2026-02-28", "amount": "300.000000000000"}],
        {"freq": "weekly", "instance_length": 13, "weekday": 6, "dom": None, "month": None},
        id="quarter from November 30 is 13 weeks",
    ),
    pytest.param(
        [*_monthly_limits(2, 3, 4), {"start": "2026-05-01", "end": "2026-05-20", "amount": "320.000000000000"}],
        None,
        id="monthly then May 1 to 20 is not recurring",
    ),
])
async def test_firefly_budget_import_stores_the_cadence_the_browser_reads(client, limits, recurrence):
    """The sent cadence is stored when the latest period is one period of it, and none stores a non-recurring budget"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, limits, recurrence=recurrence)

    stored = {
        "freq": base["recurrence_freq"],
        "instance_length": base["instance_length"],
        "weekday": base["recurrence_weekday"],
        "dom": base["recurrence_dom"],
        "month": base["recurrence_month"],
    }
    if recurrence is None:
        assert stored == {"freq": "monthly", "instance_length": 1, "weekday": None, "dom": 1, "month": None}
        assert base["recurs"] is False
    else:
        assert stored == recurrence
        assert base["recurs"] is True
    assert sorted((b["period_start"], b["period_end"]) for b in own) == [
        (limit["start"], limit["end"]) for limit in limits
    ]


@pytest.mark.parametrize(("limits", "recurrence"), [
    pytest.param(
        [{"start": "2026-01-05", "end": "2026-01-11", "amount": "40.000000000000"}],
        {"freq": "weekly", "instance_length": 1, "weekday": 1, "dom": None, "month": None},
        id="weekly on the wrong weekday",
    ),
    pytest.param(
        [*_monthly_limits(1), {"start": "2026-02-01", "end": "2026-04-30", "amount": "300.000000000000"}],
        MONTHLY_ON_THE_FIRST,
        id="one month sent for a quarter",
    ),
    pytest.param(
        [{"start": "2026-02-28", "end": "2026-03-30", "amount": "100.000000000000"}],
        {"freq": "monthly", "instance_length": 1, "weekday": None, "dom": 30, "month": None},
        id="capped anchor that starts right and ends a day early",
    ),
    pytest.param(
        [*_monthly_limits(2, 3, 4), {"start": "2026-05-01", "end": "2026-05-20", "amount": "320.000000000000"}],
        MONTHLY_ON_THE_FIRST,
        id="monthly then May 1 to 20 sent as monthly",
    ),
    pytest.param(
        [{"start": "9999-12-01", "end": "9999-12-31", "amount": "100.000000000000"}],
        MONTHLY_ON_THE_FIRST,
        id="next period past the last representable date",
    ),
])
async def test_firefly_budget_import_refuses_a_cadence_the_latest_period_does_not_fit(client, limits, recurrence):
    """A cadence whose next period would not follow the imported history is refused, naming the budget"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": [groceries_id],
            "limits": limits,
            "recurrence": recurrence,
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Groceries: the cadence does not fit the latest limit period"
    assert (await client.get("/base-budgets", headers=headers)).json() == []


@pytest.mark.parametrize("recurrence", [
    pytest.param({}, id="left out"),
    pytest.param(
        {"recurrence": {"freq": "monthly", "instance_length": 1, "weekday": 0, "dom": 1, "month": None}},
        id="monthly with a weekday",
    ),
])
async def test_firefly_budget_import_requires_a_well_formed_cadence(client, recurrence):
    """A budget without a recurrence is refused rather than silently imported not recurring, as is a malformed one"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": [groceries_id],
            "limits": _monthly_limits(1),
            **recurrence,
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert any(error["loc"] == ["body", "budgets", 0, "recurrence"] for error in resp.json()["detail"])


async def test_firefly_budget_import_rejects_overlapping_periods(client):
    """Two limit periods sharing days fail loudly instead of one silently winning"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": [groceries_id],
            "recurrence": None,
            "limits": [
                {"start": "2026-01-01", "end": "2026-01-31", "amount": "600.000000000000"},
                {"start": "2026-01-15", "end": "2026-02-14", "amount": "700.000000000000"},
            ],
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Groceries: two limit periods overlap"


async def test_firefly_budget_import_rejects_period_end_before_start(client):
    """A limit period whose end precedes its start is rejected"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": [groceries_id],
            "recurrence": None,
            "limits": [{"start": "2026-01-31", "end": "2026-01-01", "amount": "600.000000000000"}],
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Groceries: a limit period ends before it starts"


@pytest.mark.parametrize("invalid_amount", ["not-a-number", "١٢.٣٤", "12.34\u001c", " 12.34 ", "1,234.56"])
async def test_firefly_budget_import_is_atomic_across_budgets(client, invalid_amount):
    """Each malformed amount in a later budget rolls back every budget in the batch"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [
            {
                "name": "Groceries",
                "currency": "CAD",
                "category_ids": [groceries_id],
                "recurrence": None,
                "limits": [{"start": "2026-01-01", "end": "2026-01-31", "amount": "600.000000000000"}],
            },
            {
                "name": "Broken",
                "currency": "CAD",
                "category_ids": [groceries_id],
                "recurrence": None,
                "limits": [{"start": "2026-01-01", "end": "2026-01-31", "amount": invalid_amount}],
            },
        ],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == f'Broken: invalid limit amount "{invalid_amount}"'

    base_budgets_resp = await client.get("/base-budgets", headers=headers)
    assert base_budgets_resp.json() == []
    budgets_resp = await client.get("/budgets", headers=headers)
    assert budgets_resp.json() == []


async def test_firefly_budget_import_rejects_unknown_category(client):
    """Tracked categories must be visible to the importing user"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            "name": "Groceries",
            "currency": "CAD",
            "category_ids": ["00000000-0000-0000-0000-000000000000"],
            "recurrence": None,
            "limits": [{"start": "2026-01-01", "end": "2026-01-31", "amount": "600.000000000000"}],
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Groceries: a tracked category was not found"
