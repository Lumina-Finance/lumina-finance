"""How many pending institutions one person may add to the list every user shares"""

import asyncio
from uuid import UUID

from sqlalchemy import func, select, text, update

from app.models.base import InstitutionStatus
from app.models.institution import Institution
from app.models.institution_submission import InstitutionSubmission
from app.models.user import User
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.support.authorization_helpers import _sign_up_other_user
from tests.routes.support.lock_helpers import _wait_until_waiting_on

# Blank, so the app shows its generic error and the limit isn't revealed
LIMIT_DETAIL = ""

NEW_INSTITUTION = {"name": "Twenty-first Bank", "country_code": "CA", "website": "https://twentyfirst.example.com"}


async def _sign_up(client) -> tuple[dict, UUID]:
    """Sign up a user and return their headers and id"""
    headers = _get_auth_header(await _create_user(client))
    user_id = UUID((await client.get("/me", headers=headers)).json()["id"])
    return headers, user_id


async def _seed_submissions(user_id: UUID, count: int) -> list[UUID]:
    """Insert pending institutions the user added, as the route would record them"""
    async with TestSession() as session:
        institutions = [
            Institution(
                name=f"Seeded Bank {user_id} {index}",
                country_code="CA",
                website="https://seeded.example.com",
                status=InstitutionStatus.PENDING,
            )
            for index in range(count)
        ]
        session.add_all(institutions)
        await session.flush()
        session.add_all(InstitutionSubmission(institution_id=institution.id, user_id=user_id) for institution in institutions)
        await session.commit()
        return [institution.id for institution in institutions]


async def _count_institutions_named(name: str) -> int:
    async with TestSession() as session:
        return await session.scalar(select(func.count()).select_from(Institution).where(Institution.name == name))


async def test_create_institution_at_the_limit_of_pending_ones_is_refused_and_adds_nothing(client):
    """The 20th pending addition goes through, and the next is refused with nothing added."""
    headers, user_id = await _sign_up(client)
    await _seed_submissions(user_id, 19)

    twentieth = await client.post("/institutions", json={**NEW_INSTITUTION, "name": "Twentieth Bank"}, headers=headers)
    assert twentieth.status_code == 201, "the 20th pending institution is still within the limit"

    marker_before = (await client.get("/me/cache-status", headers=headers)).json()["shared_changed_at"]

    refused = await client.post("/institutions", json=NEW_INSTITUTION, headers=headers)

    assert refused.status_code == 403
    assert refused.json()["detail"] == LIMIT_DETAIL
    assert await _count_institutions_named(NEW_INSTITUTION["name"]) == 0, "a refused addition adds no institution"
    marker_after = (await client.get("/me/cache-status", headers=headers)).json()["shared_changed_at"]
    assert marker_after == marker_before, "a refused addition moves no cache marker"


async def test_create_institution_ignores_another_persons_pending_ones(client):
    """Another person's 20 pending institutions leave a new person free to add one."""
    headers, _ = await _sign_up(client)
    _, other_id = await _sign_up_other_user(client)
    await _seed_submissions(UUID(other_id), 20)

    resp = await client.post("/institutions", json=NEW_INSTITUTION, headers=headers)

    assert resp.status_code == 201


async def test_create_institution_has_room_again_once_one_of_the_pending_ones_is_approved(client):
    """An approved institution stops counting, so a person at the limit can add one more."""
    headers, user_id = await _sign_up(client)
    seeded = await _seed_submissions(user_id, 20)
    async with TestSession() as session:
        await session.execute(update(Institution).where(Institution.id == seeded[0]).values(status=InstitutionStatus.CANONICAL))
        await session.commit()

    resp = await client.post("/institutions", json=NEW_INSTITUTION, headers=headers)

    assert resp.status_code == 201


async def test_create_institution_waits_for_the_user_row_before_counting(client):
    """An addition queues behind a holder of the user's row, so it counts the holder's addition too."""
    headers, user_id = await _sign_up(client)
    await _seed_submissions(user_id, 19)

    request = None
    async with TestSession() as holder:
        # FOR NO KEY UPDATE is the strength the addition takes, and it conflicts with every row lock but
        # FOR KEY SHARE. The foreign key check of the addition's own insert takes that weaker lock, so it
        # can't stand in for the explicit one: an addition without it counts 19 and runs straight through
        await holder.execute(select(User.id).where(User.id == user_id).with_for_update(key_share=True))
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        try:
            async with asyncio.timeout(10):
                request = asyncio.create_task(client.post("/institutions", json=NEW_INSTITUTION, headers=headers))
                await _wait_until_waiting_on(holder_pid, request)
                twentieth = Institution(
                    name="Concurrent Bank", country_code="CA", website="https://concurrent.example.com", status=InstitutionStatus.PENDING
                )
                holder.add(twentieth)
                await holder.flush()
                holder.add(InstitutionSubmission(institution_id=twentieth.id, user_id=user_id))
                await holder.commit()
                resp = await request
        finally:
            await holder.rollback()
            if request is not None and not request.done():
                request.cancel()
                await asyncio.gather(request, return_exceptions=True)

    assert resp.status_code == 403
    assert resp.json()["detail"] == LIMIT_DETAIL
