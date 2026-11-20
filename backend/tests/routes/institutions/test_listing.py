"""Paging and search of GET /institutions, which every user's account forms and import steps read from one shared table."""

import pytest

from app.models.base import InstitutionStatus
from app.models.institution import Institution
from app.utils.pagination import LIST_PAGE_SIZE, LIST_SEARCH_MAX_LENGTH, MAX_LIST_OFFSET
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header


async def _seed_institution_rows(names, country_code="CA"):
    """Insert one canonical institution per name in a single commit

    Args:
        names: Institution names, each stored with the given country
        country_code: ISO 3166-1 alpha-2 code every row takes
    """
    async with TestSession() as session:
        session.add_all(
            Institution(
                name=name,
                country_code=country_code,
                website="https://bank.example.com",
                status=InstitutionStatus.CANONICAL,
            )
            for name in names
        )
        await session.commit()


async def test_list_institutions_without_a_limit_returns_the_first_fifty(client):
    """A request that sends no limit gets one page of the table, not every row."""
    await _seed_institution_rows([f"Bank {number:03d}" for number in range(LIST_PAGE_SIZE + 10)])
    headers = _get_auth_header(await _create_user(client))

    resp = await client.get("/institutions", headers=headers)

    assert resp.status_code == 200
    names = [institution["name"] for institution in resp.json()]
    assert names == [f"Bank {number:03d}" for number in range(LIST_PAGE_SIZE)]


async def test_list_institutions_pages_cover_every_row_once(client):
    """Pages follow each other without repeating or skipping a row, even when two countries share a name."""
    await _seed_institution_rows(["Alpha", "Bravo", "Charlie", "Delta"], country_code="CA")
    await _seed_institution_rows(["Alpha", "Bravo", "Charlie"], country_code="US")
    headers = _get_auth_header(await _create_user(client))

    whole = await client.get("/institutions", headers=headers)
    pages = [await client.get("/institutions", params={"limit": 3, "offset": offset}, headers=headers) for offset in (0, 3, 6)]

    assert [len(page.json()) for page in pages] == [3, 3, 1]
    paged_ids = [institution["id"] for page in pages for institution in page.json()]
    assert paged_ids == [institution["id"] for institution in whole.json()]
    assert len(set(paged_ids)) == 7


async def test_list_institutions_searches_names_ignoring_case_and_wildcards(client):
    """The search term matches anywhere in a name, and a percent sign or underscore matches itself."""
    await _seed_institution_rows(["Royal Bank", "Bank of Montreal", "Credit Union 50%", "Credit Union 50 Plus", "A_B Trust"])
    headers = _get_auth_header(await _create_user(client))

    by_case = await client.get("/institutions", params={"q": "BANK"}, headers=headers)
    by_percent = await client.get("/institutions", params={"q": "50%"}, headers=headers)
    by_underscore = await client.get("/institutions", params={"q": "A_B"}, headers=headers)
    by_blank = await client.get("/institutions", params={"q": "   "}, headers=headers)

    assert [i["name"] for i in by_case.json()] == ["Bank of Montreal", "Royal Bank"]
    assert [i["name"] for i in by_percent.json()] == ["Credit Union 50%"]
    assert [i["name"] for i in by_underscore.json()] == ["A_B Trust"]
    assert len(by_blank.json()) == 5


async def test_list_institutions_search_reaches_rows_past_the_first_page(client):
    """A name beyond the first fifty is found by searching for it."""
    await _seed_institution_rows([f"Bank {number:03d}" for number in range(LIST_PAGE_SIZE + 10)])
    await _seed_institution_rows(["Zed Credit Union"])
    headers = _get_auth_header(await _create_user(client))

    resp = await client.get("/institutions", params={"q": "zed"}, headers=headers)

    assert [institution["name"] for institution in resp.json()] == ["Zed Credit Union"]


async def test_list_institutions_search_composes_with_the_country_filter(client):
    """The country filter and the search term both apply."""
    # Each row the filters should drop fails exactly one of them
    await _seed_institution_rows(["Maple Bank"], country_code="CA")
    await _seed_institution_rows(["Maple Savings", "Other Savings"], country_code="US")
    headers = _get_auth_header(await _create_user(client))

    resp = await client.get("/institutions", params={"q": "maple", "country_code": "US"}, headers=headers)

    assert [institution["name"] for institution in resp.json()] == ["Maple Savings"]


async def test_list_institutions_orders_equal_names_by_id(client):
    """Rows sharing a name keep one order from page to page, so a page boundary never splits them differently."""
    await _seed_institution_rows(["Twin Bank"], country_code="CA")
    await _seed_institution_rows(["Twin Bank"], country_code="US")
    await _seed_institution_rows(["Twin Bank"], country_code="GB")
    headers = _get_auth_header(await _create_user(client))

    resp = await client.get("/institutions", params={"q": "twin"}, headers=headers)

    ids = [institution["id"] for institution in resp.json()]
    assert len(ids) == 3
    assert ids == sorted(ids)


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": LIST_PAGE_SIZE + 1},
        {"offset": -1},
        {"offset": MAX_LIST_OFFSET + 1},
        {"q": "x" * (LIST_SEARCH_MAX_LENGTH + 1)},
    ],
)
async def test_list_institutions_refuses_paging_outside_its_bounds(client, params):
    """A limit, offset or search term outside the route's bounds is refused."""
    headers = _get_auth_header(await _create_user(client))

    resp = await client.get("/institutions", params=params, headers=headers)

    assert resp.status_code == 422


async def test_list_institutions_accepts_the_largest_offset(client):
    """The offset bound is inclusive, and a start past the end returns an empty page."""
    await _seed_institution_rows(["Only Bank"])
    headers = _get_auth_header(await _create_user(client))

    resp = await client.get("/institutions", params={"offset": MAX_LIST_OFFSET}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []
