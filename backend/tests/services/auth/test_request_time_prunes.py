"""A reset request and a sign-up prune only the rows their own limit counts

Pruning every account's or address's old rows inside a request makes each request slower as other
people's rows pile up, so these count the rows read while others have hundreds. The scheduled cleanup
removes the rest
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app.models.auth import PasswordResetToken, SignupEmailSend
from app.services.auth.password_reset import delete_account_stale_password_reset_tokens
from app.services.auth.signup import delete_address_stale_signup_email_sends
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.identity_helpers import _seed_users
from tests.routes.support.query_cost_helpers import SLACK, _avoid_full_scans, _rows_read

# How many stale rows belong to other accounts or addresses
OTHERS_ROWS = 300

STALE = timedelta(hours=25)
RECENT = timedelta(hours=1)


async def test_a_reset_request_prunes_only_the_requesters_stale_rows_and_reads_no_others():
    """The requester's old link goes, a recent one stays, and the other accounts' old links are never read"""
    now = datetime.now(UTC)
    requester, other = await _seed_users("requester@example.com", "other@example.com")

    def link(owner, name: str, age: timedelta) -> PasswordResetToken:
        return PasswordResetToken(user_id=owner.id, token_hash=name, expires_at=now, created_at=now - age)

    async with TestSession() as session:
        session.add_all([link(other, f"other{index}", STALE) for index in range(OTHERS_ROWS)])
        session.add_all([link(requester, "stale", STALE), link(requester, "recent", RECENT)])
        await session.commit()
        await session.execute(text("ANALYZE"))
        await session.commit()

    async with ScopedSession() as session:
        await _avoid_full_scans(session)
        await delete_account_stale_password_reset_tokens(session, requester.id)
        rows_read = await _rows_read(session, "password_reset_tokens")
        remaining = set(await session.scalars(select(PasswordResetToken.token_hash).where(PasswordResetToken.user_id == requester.id)))

    assert remaining == {"recent"}
    assert 1 <= rows_read < 2 + SLACK, f"read {rows_read} rows while the requester owns 2 and others hold {OTHERS_ROWS}"


async def test_a_sign_up_prunes_only_its_addresss_stale_records_and_reads_no_others():
    """The address's old record goes, a recent one stays, and the other addresses' old records are never read"""
    now = datetime.now(UTC)

    async with TestSession() as session:
        session.add_all([SignupEmailSend(email_hash=f"other{index}", created_at=now - STALE) for index in range(OTHERS_ROWS)])
        session.add_all(
            [
                SignupEmailSend(email_hash="address", created_at=now - STALE),
                SignupEmailSend(email_hash="address", created_at=now - RECENT),
            ]
        )
        await session.commit()
        await session.execute(text("ANALYZE"))
        await session.commit()

    async with ScopedSession() as session:
        await _avoid_full_scans(session)
        await delete_address_stale_signup_email_sends(session, "address")
        rows_read = await _rows_read(session, "signup_email_sends")
        remaining = list(await session.scalars(select(SignupEmailSend.created_at).where(SignupEmailSend.email_hash == "address")))

    assert len(remaining) == 1 and remaining[0] > now - STALE
    assert 1 <= rows_read < 2 + SLACK, f"read {rows_read} records while the address owns 2 and others hold {OTHERS_ROWS}"
