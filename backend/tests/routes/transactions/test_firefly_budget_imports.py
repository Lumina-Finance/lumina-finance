import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

from app.database import current_user_id_ctx
from app.models.base import CategoryKind
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.category import Category
from tests.conftest import ScopedSession, TestSession, scoped_engine
from tests.routes.base_budgets._helpers import _create_category, _create_group, _create_second_user
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _get_auth_header


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


@contextmanager
def _observe_budget_import() -> Iterator[Callable[[], _BudgetImportObservations]]:
    """Observe category reads and budget-bearing flushes for one app-role request"""
    category_selects = 0
    flushes: list[_BudgetFlushObservation] = []
    budget_session: Session | None = None
    commits = 0
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
        nonlocal budget_session
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

    def after_commit(session: Session) -> None:
        """Count commits only for the request session that flushed budget rows"""
        nonlocal commits
        if session is budget_session:
            commits += 1

    def snapshot() -> _BudgetImportObservations:
        """Freeze the counts collected so far"""
        return _BudgetImportObservations(category_selects, tuple(flushes), commits)

    event.listen(scoped_engine.sync_engine, "before_cursor_execute", before_cursor_execute)
    event.listen(sync_session_class, "before_flush", before_flush)
    event.listen(sync_session_class, "after_commit", after_commit)
    try:
        yield snapshot
    finally:
        event.remove(scoped_engine.sync_engine, "before_cursor_execute", before_cursor_execute)
        event.remove(sync_session_class, "before_flush", before_flush)
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


async def _import_one_budget(client, headers, category_id, limits, name="Groceries", is_archived=None):
    """Import one budget and return the created base budget and its instances

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        category_id: Tracked category for the budget
        limits: Limit periods for the import payload
        name: Budget name
        is_archived: Archived flag for the payload, omitted when None so the
            default is exercised

    Returns:
        Base budget response paired with its instance list
    """
    payload = {
        "name": name,
        "currency": "CAD",
        "category_ids": [category_id],
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


async def test_firefly_budget_import_batches_shared_category_lookup(client, record_property):
    """Shared categories need one lookup without changing imported budgets or isolation"""
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
    assert observations.category_selects == 1, observations


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
                "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.00"}],
            },
            {
                "name": "Second category chunk",
                "currency": "CAD",
                "category_ids": [str(category_ids[-1]), str(category_ids[0]), str(category_ids[0])],
                "limits": [{"start": "2025-02-01", "end": "2025-02-28", "amount": "200.00"}],
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
            "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.00"}],
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
                "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.00"}],
            }],
        }, headers=headers)
        assert response.status_code == 422
        assert response.json()["detail"] == "Category not found"

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
        "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "not-a-number"}],
    }
    missing_category_budget = {
        "name": "Missing category",
        "currency": "CAD",
        "category_ids": [missing_category_id],
        "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.00"}],
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
    assert missing_first.json()["detail"] == "Category not found"

    same_budget = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [{
            **malformed_budget,
            "category_ids": [missing_category_id],
        }],
    }, headers=headers)
    assert same_budget.status_code == 422
    assert same_budget.json()["detail"] == "Category not found"


async def test_firefly_budget_import_validates_currencies_before_budgets(client):
    """Currency validation retains its upfront lexical error before budget-local failures"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    valid_category_id = await _get_category_id(client, headers, "Groceries")
    response = await client.post("/transactions/import/firefly/budgets", json={
        "budgets": [
            {
                "name": "Malformed CAD",
                "currency": "CAD",
                "category_ids": [valid_category_id],
                "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "not-a-number"}],
            },
            {
                "name": "Missing ZZZ",
                "currency": "ZZZ",
                "category_ids": [valid_category_id],
                "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.00"}],
            },
            {
                "name": "Missing AAA",
                "currency": "AAA",
                "category_ids": [valid_category_id],
                "limits": [{"start": "2025-01-01", "end": "2025-01-31", "amount": "100.00"}],
            },
        ],
    }, headers=headers)

    assert response.status_code == 422
    assert response.json()["detail"] == "Invalid currency code: AAA"


async def test_firefly_budget_import_mirrors_limit_periods(client):
    """Each limit period becomes one instance, and gaps stay gaps"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2025-01-01", "end": "2025-01-31", "amount": "600.00"},
        {"start": "2025-03-01", "end": "2025-03-31", "amount": "650.50"},
    ])

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
        {"start": "2025-01-01", "end": "2025-01-31", "amount": "600.00"},
        {"start": "2025-02-01", "end": "2025-02-28", "amount": "620.00"},
    ], is_archived=True)

    assert base["is_archived"] is True
    periods = {(b["period_start"], b["period_end"]): b["overall_limit"] for b in own}
    assert periods == {
        ("2025-01-01", "2025-01-31"): 60000,
        ("2025-02-01", "2025-02-28"): 62000,
    }


async def test_firefly_budget_import_reads_cadence_from_latest_period(client):
    """A budget that moved from monthly to quarterly limits continues quarterly"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2023-12-01", "end": "2023-12-31", "amount": "140.00"},
        {"start": "2024-01-01", "end": "2024-03-31", "amount": "420.00"},
    ])

    assert base["recurrence_freq"] == "monthly"
    assert base["instance_length"] == 3
    assert base["recurrence_dom"] == 1
    assert base["recurs"] is True
    assert len(own) == 2


async def test_firefly_budget_import_maps_yearly_periods(client):
    """Twelve-month limit periods continue as a yearly budget"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2024-01-01", "end": "2024-12-31", "amount": "540.00"},
        {"start": "2025-01-01", "end": "2025-12-31", "amount": "560.00"},
    ])

    assert base["recurrence_freq"] == "yearly"
    assert base["instance_length"] == 1
    assert base["recurrence_month"] == 1
    assert base["recurrence_dom"] == 1
    assert base["recurs"] is True
    assert len(own) == 2


async def test_firefly_budget_import_maps_weekly_periods(client):
    """Seven-day limit periods continue as a weekly budget on their weekday"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2026-01-05", "end": "2026-01-11", "amount": "40.00"},
        {"start": "2026-01-12", "end": "2026-01-18", "amount": "42.00"},
    ])

    assert base["recurrence_freq"] == "weekly"
    assert base["instance_length"] == 1
    assert base["recurrence_weekday"] == 0
    assert base["recurs"] is True
    assert len(own) == 2


async def test_firefly_budget_import_keeps_mid_month_monthly_anchor(client):
    """A month-long period starting mid-month anchors on that day of month"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2026-01-15", "end": "2026-02-14", "amount": "100.00"},
    ])

    assert base["recurrence_freq"] == "monthly"
    assert base["recurrence_dom"] == 15
    assert base["recurs"] is True
    assert own[0]["period_start"] == "2026-01-15"
    assert own[0]["period_end"] == "2026-02-14"


async def test_firefly_budget_import_recovers_capped_month_end_anchor(client):
    """A period starting on a short month's last day recovers its real anchor"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    # February 28 is the capped form of a day-31 anchor, which only the
    # period end can disambiguate
    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2026-02-28", "end": "2026-03-30", "amount": "100.00"},
    ])

    assert base["recurrence_freq"] == "monthly"
    assert base["recurrence_dom"] == 31
    assert base["recurs"] is True
    assert len(own) == 1


async def test_firefly_budget_import_falls_back_for_irregular_period(client):
    """A period fitting no cadence imports verbatim as a non-recurring budget"""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    groceries_id = await _get_category_id(client, headers, "Groceries")

    base, own = await _import_one_budget(client, headers, groceries_id, [
        {"start": "2024-10-04", "end": "2024-10-26", "amount": "800.00"},
    ])

    assert base["recurrence_freq"] == "monthly"
    assert base["instance_length"] == 1
    assert base["recurrence_dom"] == 1
    assert base["recurs"] is False
    assert own[0]["period_start"] == "2024-10-04"
    assert own[0]["period_end"] == "2024-10-26"
    assert own[0]["overall_limit"] == 80000


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
            "limits": [
                {"start": "2026-01-01", "end": "2026-01-31", "amount": "600.00"},
                {"start": "2026-01-15", "end": "2026-02-14", "amount": "700.00"},
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
            "limits": [{"start": "2026-01-31", "end": "2026-01-01", "amount": "600.00"}],
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
                "limits": [{"start": "2026-01-01", "end": "2026-01-31", "amount": "600.00"}],
            },
            {
                "name": "Broken",
                "currency": "CAD",
                "category_ids": [groceries_id],
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
            "limits": [{"start": "2026-01-01", "end": "2026-01-31", "amount": "600.00"}],
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"
