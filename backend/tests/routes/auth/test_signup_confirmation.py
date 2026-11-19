"""Sign-up confirmation route tests: the same answer for every address, accounts only once confirmed"""

import asyncio
import logging
import traceback
from datetime import UTC, datetime, timedelta

import aiosmtplib
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import func as sa_func
from sqlalchemy import select

from app.config.jwt import JWT_ACCESS_PRIVATE_KEY, JWT_ALGORITHM, JWT_ISSUER
from app.config.registration import SIGNUP_DAILY_EMAIL_LIMIT
from app.models.auth import AuthIdentity, PasswordCredential, SignupEmailSend
from app.models.user import User
from app.services.auth import registration, send_backoff, signup
from app.services.auth.signup_email_hash import seal_signup_email
from app.services.auth.tokens import SIGNUP_CONFIRMATION_TOKEN_USE
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _seed_currency, sign_up_confirmed
from tests.routes.support.mailbox import mailbox

_PROFILE = {key: value for key, value in SIGNUP_PAYLOAD.items() if key != "password"}
_NEW_PASSWORD = "AnotherPassword456!"
_FOREIGN_KEY = (
    rsa.generate_private_key(public_exponent=65537, key_size=2048)
    .private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    .decode()
)


def _link_token(
    email: str = SIGNUP_PAYLOAD["email"],
    *,
    minutes_to_expiry: int = 60,
    token_use: str = SIGNUP_CONFIRMATION_TOKEN_USE,
    audience: str = SIGNUP_CONFIRMATION_TOKEN_USE,
    issuer: str = JWT_ISSUER,
    key: str = JWT_ACCESS_PRIVATE_KEY,
) -> str:
    """Return a signed confirmation token built to be valid, with one field changeable per edge-case test"""
    issued_at = datetime.now(UTC)
    payload = {
        "email": email,
        "first_name": "Test",
        "last_name": None,
        "tz": "America/Toronto",
        "base_currency": "CAD",
        "token_use": token_use,
        "aud": audience,
        "iat": issued_at,
        "exp": issued_at + timedelta(minutes=minutes_to_expiry),
        "iss": issuer,
    }
    return jwt.encode(payload, key, algorithm=JWT_ALGORITHM)


async def _users() -> list[User]:
    """Return every user row"""
    async with TestSession() as session:
        return list((await session.execute(select(User))).scalars())


async def test_new_address_gets_a_confirmation_link_and_no_account(client):
    """A new address is emailed a confirmation link, and nothing works until the link is used"""
    await _seed_currency()
    resp = await client.post("/auth/signup", json=_PROFILE)

    assert resp.status_code == 204
    emails = mailbox.sent_to(_PROFILE["email"])
    assert len(emails) == 1
    assert "/confirm-email?token=" in emails[0].message.text_body
    assert await _users() == []

    login = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": SIGNUP_PAYLOAD["password"]})
    assert login.status_code == 401


@pytest.mark.parametrize("base_currency", ["US\u0000D", "US\u0000"])
async def test_signup_refuses_a_base_currency_with_a_null_character_and_sends_nothing(client, base_currency):
    """A NUL in the base currency is refused on that field before any mail goes out, whatever the length"""
    await _seed_currency()

    resp = await client.post("/auth/signup", json={**_PROFILE, "base_currency": base_currency})

    assert resp.status_code == 422
    assert resp.json() == {"detail": [{"type": "value_error", "loc": ["body", "base_currency"], "msg": "Must not contain a null character"}]}
    assert mailbox.sent == []
    assert await _users() == []


async def test_registered_address_gets_the_same_response_and_no_email(client):
    """A registered address answers exactly as a new one does, and nothing is sent to it"""
    await _seed_currency()
    new_address = await client.post("/auth/signup", json={**_PROFILE, "email": "new@example.com"})
    await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    mailbox.sent.clear()

    registered = await client.post("/auth/signup", json=_PROFILE)

    assert (registered.status_code, registered.content) == (new_address.status_code, new_address.content)
    assert set(registered.headers) == set(new_address.headers)
    assert mailbox.sent == []

    # Nothing about the account changes: still one user, still signing in with the original password
    assert len(await _users()) == 1
    login = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": SIGNUP_PAYLOAD["password"]})
    assert login.status_code == 200


async def test_confirming_creates_a_verified_account_with_the_password_chosen_at_confirmation(client):
    """Whoever opens the link chooses the password, so a password sent with the sign-up is ignored"""
    await _seed_currency()
    await client.post("/auth/signup", json={**_PROFILE, "password": "AttackerChosen123!"})
    token = mailbox.confirmation_token(_PROFILE["email"])

    resp = await client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD})

    assert resp.status_code == 201
    assert resp.json()["user"]["email"] == _PROFILE["email"]
    assert resp.json()["access_token"]

    async with TestSession() as session:
        identity = (await session.execute(select(AuthIdentity))).scalar_one()
        assert identity.email_verified is True
        assert identity.email_verified_at is not None
        assert (await session.execute(select(PasswordCredential))).scalar_one()

    chosen = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": _NEW_PASSWORD})
    sent_with_signup = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": "AttackerChosen123!"})
    assert chosen.status_code == 200
    assert sent_with_signup.status_code == 401


async def test_a_link_works_once(client):
    """Using a link again answers like an invalid one, and the account keeps the first password"""
    await _seed_currency()
    await client.post("/auth/signup", json=_PROFILE)
    token = mailbox.confirmation_token(_PROFILE["email"])
    first = await client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD})

    second = await client.post("/auth/signup/confirm", json={"token": token, "new_password": "ThirdPassword789!"})

    assert first.status_code == 201
    assert second.status_code == 400
    assert second.json()["detail"] == "Invalid or expired confirmation link"
    assert len(await _users()) == 1
    login = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": _NEW_PASSWORD})
    assert login.status_code == 200


async def test_two_confirmations_of_one_link_create_one_account(client):
    """Concurrent uses of a link create one account, and the other answers like an invalid link"""
    await _seed_currency()
    await client.post("/auth/signup", json=_PROFILE)
    token = mailbox.confirmation_token(_PROFILE["email"])

    responses = await asyncio.gather(
        client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD}),
        client.post("/auth/signup/confirm", json={"token": token, "new_password": "ThirdPassword789!"}),
    )

    assert sorted(response.status_code for response in responses) == [201, 400]
    assert len(await _users()) == 1


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(_link_token(minutes_to_expiry=-1), id="expired"),
        pytest.param(_link_token(audience="access"), id="another audience"),
        pytest.param(_link_token(token_use="access"), id="another token use"),
        pytest.param(_link_token(issuer="someone-else"), id="another issuer"),
        pytest.param(_link_token(key=_FOREIGN_KEY), id="signed with another key"),
        pytest.param("not-a-token", id="garbage"),
    ],
)
async def test_confirming_refuses_a_link_that_does_not_verify(client, token):
    """An expired, foreign or garbled link creates no account and gives the one generic message"""
    await _seed_currency()

    resp = await client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD})

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid or expired confirmation link"
    assert await _users() == []


async def test_a_confirmation_link_is_not_a_login_token(client):
    """The emailed token opens no authenticated route, so a leaked link never acts as a session"""
    resp = await client.get("/auth/2fa/status", headers={"Authorization": f"Bearer {_link_token()}"})

    assert resp.status_code == 401


async def test_confirming_with_a_weak_password_creates_no_account_and_keeps_the_link(client):
    """The password policy applies where the password is chosen, and a refusal does not spend the link"""
    await _seed_currency()
    token = _link_token()

    weak = await client.post("/auth/signup/confirm", json={"token": token, "new_password": "weak"})
    assert weak.status_code == 422
    assert weak.json()["detail"][0]["loc"][-1] == "new_password"
    assert await _users() == []

    retry = await client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD})
    assert retry.status_code == 201


async def test_emails_per_address_are_capped(client):
    """Repeated sign-ups cannot drain the mail quota"""
    await _seed_currency()
    for _ in range(SIGNUP_DAILY_EMAIL_LIMIT + 4):
        assert (await client.post("/auth/signup", json={**_PROFILE, "email": "new-address@example.com"})).status_code == 204

    assert len(mailbox.sent_to("new-address@example.com")) == SIGNUP_DAILY_EMAIL_LIMIT


async def test_the_cap_counts_spellings_that_differ_only_in_case_as_one_address(client):
    """Mail goes to one inbox however the address is capitalised, so the cap cannot be sidestepped by case"""
    await _seed_currency()
    spellings = ["victim@example.com", "Victim@example.com", "vIctim@example.com", "VICTIM@example.com"]
    for spelling in spellings * 2:
        await client.post("/auth/signup", json={**_PROFILE, "email": spelling})

    assert len(mailbox.sent_to("victim@example.com")) == SIGNUP_DAILY_EMAIL_LIMIT


async def test_the_cap_is_per_address(client):
    """One address reaching its cap leaves every other address able to sign up"""
    await _seed_currency()
    for _ in range(SIGNUP_DAILY_EMAIL_LIMIT + 1):
        await client.post("/auth/signup", json={**_PROFILE, "email": "capped@example.com"})

    await client.post("/auth/signup", json={**_PROFILE, "email": "other@example.com"})

    assert len(mailbox.sent_to("other@example.com")) == 1


async def _send_record_count() -> int:
    """Return how many sign-up sends count against any address"""
    async with TestSession() as session:
        return await session.scalar(select(sa_func.count()).select_from(SignupEmailSend))


async def test_a_failed_send_makes_the_address_wait_and_is_logged_not_shown(client, caplog, monkeypatch, reset_clock):
    """A broken mail server cannot tell addresses apart, and sign-ups during the wait start no send and use no cap"""
    await _seed_currency()
    attempts = []

    async def refuse(recipient, message):
        attempts.append(recipient)
        raise ConnectionError("mail server unreachable")

    with monkeypatch.context() as broken:
        broken.setattr(mailbox, "send", refuse)
        with caplog.at_level(logging.INFO):
            responses = [await client.post("/auth/signup", json=_PROFILE) for _ in range(SIGNUP_DAILY_EMAIL_LIMIT + 2)]

    assert {response.status_code for response in responses} == {204}
    assert "Sign-up email failed to send" in caplog.text
    assert _PROFILE["email"] not in caplog.text
    assert len(attempts) == 1, "only the first request starts a send"
    assert await _send_record_count() == 0, "neither the failed send nor the skipped ones use up the cap"

    # The wait ends and the recovered server sends the email
    reset_clock(send_backoff.FIRST_FAILURE_WAIT_SECONDS - 1)
    await client.post("/auth/signup", json=_PROFILE)
    assert mailbox.sent_to(_PROFILE["email"]) == []
    reset_clock(1)
    await client.post("/auth/signup", json=_PROFILE)
    assert len(mailbox.sent_to(_PROFILE["email"])) == 1


async def test_an_email_that_cannot_be_rendered_makes_the_address_wait_like_a_failed_send(client, caplog, monkeypatch, reset_clock):
    """Rendering runs after the response, so a failure there is handled like a failed send"""
    await _seed_currency()

    def cannot_render(*args):
        raise RuntimeError("template missing")

    with monkeypatch.context() as broken:
        broken.setattr("app.services.auth.signup.render_signup_confirmation_email", cannot_render)
        with caplog.at_level(logging.WARNING):
            response = await client.post("/auth/signup", json=_PROFILE)

    assert response.status_code == 204
    assert "Sign-up email failed to send" in caplog.text
    assert await _send_record_count() == 0

    # Rendering works again, but the address still waits
    await client.post("/auth/signup", json=_PROFILE)
    assert mailbox.sent_to(_PROFILE["email"]) == []

    reset_clock(send_backoff.FIRST_FAILURE_WAIT_SECONDS)
    await client.post("/auth/signup", json=_PROFILE)
    assert len(mailbox.sent_to(_PROFILE["email"])) == 1


async def test_a_delivered_email_clears_the_wait(client, monkeypatch, reset_clock):
    """After mail works again the next failure waits a minute, not the doubled wait the earlier failures built up"""
    await _seed_currency()
    outcomes = iter([False, False, True, False])
    attempts = []

    async def send(recipient, message):
        attempts.append(recipient)
        if not next(outcomes):
            raise ConnectionError("mail server unreachable")

    monkeypatch.setattr(mailbox, "send", send)
    first_wait = send_backoff.FIRST_FAILURE_WAIT_SECONDS

    await client.post("/auth/signup", json=_PROFILE)
    reset_clock(first_wait)
    await client.post("/auth/signup", json=_PROFILE)
    assert len(attempts) == 2

    # The second failure doubled the wait, so the delivery comes after two minutes
    reset_clock(2 * first_wait)
    await client.post("/auth/signup", json=_PROFILE)
    assert len(attempts) == 3

    await client.post("/auth/signup", json=_PROFILE)
    assert len(attempts) == 4, "a delivered email leaves no wait"
    reset_clock(first_wait - 1)
    await client.post("/auth/signup", json=_PROFILE)
    assert len(attempts) == 4
    reset_clock(1)
    await client.post("/auth/signup", json=_PROFILE)
    assert len(attempts) == 5, "the failure after a delivery waits one minute"


async def test_a_failed_send_makes_only_its_own_address_wait(client, monkeypatch):
    """Mail failing for one address leaves every other address able to sign up"""
    await _seed_currency()
    attempts = []

    async def refuse_one(recipient, message):
        attempts.append(recipient)
        if recipient == "failing@example.com":
            raise ConnectionError("mailbox unreachable")

    monkeypatch.setattr(mailbox, "send", refuse_one)

    await client.post("/auth/signup", json={**_PROFILE, "email": "failing@example.com"})

    # Mail to either spelling reaches one inbox, so changing the capitals does not skip the wait
    await client.post("/auth/signup", json={**_PROFILE, "email": "Failing@Example.com"})
    await client.post("/auth/signup", json={**_PROFILE, "email": "other@example.com"})

    assert attempts == ["failing@example.com", "other@example.com"]


async def test_overlapping_sign_ups_for_one_address_start_one_send(client, monkeypatch):
    """A send can take tens of seconds, so requests arriving meanwhile start no second one, and the place frees afterwards"""
    await _seed_currency()
    started = asyncio.Event()
    release = asyncio.Event()
    attempts = []

    async def slow_first_send(recipient, message):
        attempts.append(recipient)
        if len(attempts) == 1:
            started.set()
            await release.wait()

    monkeypatch.setattr(mailbox, "send", slow_first_send)

    first = asyncio.create_task(client.post("/auth/signup", json=_PROFILE))
    await started.wait()
    overlapping = [await client.post("/auth/signup", json=_PROFILE) for _ in range(3)]
    release.set()
    first_response = await first

    assert {response.status_code for response in [first_response, *overlapping]} == {204}
    assert len(attempts) == 1
    assert await _send_record_count() == 1, "the skipped requests release their cap records"

    await client.post("/auth/signup", json=_PROFILE)
    assert len(attempts) == 2, "the finished send no longer blocks the address"


async def test_a_refused_recipient_is_logged_by_error_class_and_never_by_address(client, caplog, monkeypatch):
    """The mail library's error text quotes the address, so the warning names only the class"""
    await _seed_currency()
    address = "refused-address@example.com"
    error = aiosmtplib.SMTPRecipientsRefused([aiosmtplib.SMTPRecipientRefused(550, "Mailbox unavailable", address)])
    assert address in str(error), "the error carries the address, so only the log decides whether it leaks"

    async def refuse(recipient, message):
        raise error

    monkeypatch.setattr(mailbox, "send", refuse)
    with caplog.at_level(logging.INFO):
        await client.post("/auth/signup", json={**_PROFILE, "email": address})

    assert "SMTPRecipientsRefused" in caplog.text
    assert address not in caplog.text


async def test_a_refused_recipient_stays_out_of_the_traceback_when_releasing_its_cap_also_fails(client, caplog, monkeypatch):
    """The server logs an error escaping a background task with its whole chain, so the mail error must not ride along"""
    await _seed_currency()
    address = "refused-address@example.com"

    async def refuse(recipient, message):
        raise aiosmtplib.SMTPRecipientsRefused([aiosmtplib.SMTPRecipientRefused(550, "Mailbox unavailable", address)])

    async def broken_delete(_send_id, _session_factory):
        raise RuntimeError("database is down")

    monkeypatch.setattr(mailbox, "send", refuse)
    monkeypatch.setattr(signup, "_delete_send_record", broken_delete)
    with caplog.at_level(logging.INFO), pytest.raises(RuntimeError, match="database is down") as raised:
        await client.post("/auth/signup", json={**_PROFILE, "email": address})

    assert address not in "".join(traceback.format_exception(raised.value))
    assert "SMTPRecipientsRefused" in caplog.text, "the warning is logged before the release fails"


async def test_a_send_record_older_than_a_day_no_longer_counts(client):
    """The cap is per rolling day, so an address that used it up yesterday can be emailed again"""
    await _seed_currency()
    old = datetime.now(UTC) - timedelta(hours=25)
    other_hash = seal_signup_email("other-address@example.com")
    async with TestSession() as session:
        session.add_all(
            SignupEmailSend(email_hash=seal_signup_email(_PROFILE["email"]), created_at=old) for _ in range(SIGNUP_DAILY_EMAIL_LIMIT)
        )
        session.add(SignupEmailSend(email_hash=other_hash, created_at=old))
        await session.commit()

    await client.post("/auth/signup", json=_PROFILE)

    async with TestSession() as session:
        stale = list(await session.scalars(select(SignupEmailSend.email_hash).where(SignupEmailSend.created_at == old)))
    assert len(mailbox.sent_to(_PROFILE["email"])) == 1
    assert stale == [other_hash], "the address's old records are pruned, and another address's is left for the schedule"


async def test_the_cap_stores_only_a_keyed_hash_of_the_address(client):
    """The send record holds no address, so it exposes nobody who tried to sign up"""
    await _seed_currency()
    await client.post("/auth/signup", json=_PROFILE)

    async with TestSession() as session:
        sends = list((await session.execute(select(SignupEmailSend))).scalars())

    assert [send.email_hash for send in sends] == [seal_signup_email(_PROFILE["email"])]
    assert _PROFILE["email"] not in sends[0].email_hash


async def test_sign_up_is_refused_when_registration_is_closed(client, monkeypatch):
    """A closed instance sends no email, which its public registration status already tells everyone"""
    await _seed_currency()
    monkeypatch.setattr(registration, "REGISTRATION_ENABLED", False)

    resp = await client.post("/auth/signup", json=_PROFILE)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Registration is closed on this instance"
    assert mailbox.sent == []


async def test_confirming_for_an_address_registered_meanwhile_gives_the_invalid_link_answer(client):
    """A link for an address that gained an account since is refused, never touching the account"""
    await _seed_currency()
    await client.post("/auth/signup", json=_PROFILE)
    token = mailbox.confirmation_token(_PROFILE["email"])
    await sign_up_confirmed(client, SIGNUP_PAYLOAD)

    resp = await client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD})

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid or expired confirmation link"
    login = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": SIGNUP_PAYLOAD["password"]})
    assert login.status_code == 200


async def test_confirming_after_registration_closes_creates_no_account(client, monkeypatch):
    """A link sent while registration was open is refused once it closes"""
    await _seed_currency()
    await client.post("/auth/signup", json=_PROFILE)
    token = mailbox.confirmation_token(_PROFILE["email"])
    monkeypatch.setattr(registration, "REGISTRATION_ENABLED", False)

    resp = await client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD})

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Registration is closed on this instance"
    assert await _users() == []


async def test_a_registered_address_in_other_capitals_gets_the_same_response_and_no_email(client):
    """Signing up again with the address typed in other capitals reveals nothing and sends nothing"""
    await _seed_currency()
    new_address = await client.post("/auth/signup", json={**_PROFILE, "email": "new@example.com"})
    await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "Alice@example.com"})
    mailbox.sent.clear()

    registered = await client.post("/auth/signup", json={**_PROFILE, "email": "alice@example.com"})

    assert (registered.status_code, registered.content) == (new_address.status_code, new_address.content)
    assert mailbox.sent == []
    assert len(await _users()) == 1


async def test_links_for_two_capitalisations_confirmed_at_once_create_one_account(client):
    """Bob@ and bob@ confirming at the same moment leave one account, and the other answers like an invalid link"""
    await _seed_currency()

    responses = await asyncio.gather(
        client.post("/auth/signup/confirm", json={"token": _link_token("Bob@example.com"), "new_password": _NEW_PASSWORD}),
        client.post("/auth/signup/confirm", json={"token": _link_token("bob@example.com"), "new_password": _NEW_PASSWORD}),
    )

    assert sorted(response.status_code for response in responses) == [201, 400]
    assert len(await _users()) == 1


async def test_the_database_refuses_the_second_capitalisation_when_the_check_misses_it(client, monkeypatch):
    """The unique index, not only the lookup, stops a second account differing only in capitals"""
    await _seed_currency()
    await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "Bob@example.com"})

    async def blind_lookup(db, email):
        """Let confirmation proceed as if no account had the address"""
        return None

    monkeypatch.setattr(signup, "find_user_id_by_email", blind_lookup)

    resp = await client.post("/auth/signup/confirm", json={"token": _link_token("bob@example.com"), "new_password": _NEW_PASSWORD})

    assert resp.status_code == 400
    assert [user.email for user in await _users()] == ["Bob@example.com"]


async def test_confirming_a_link_for_other_capitals_of_a_registered_address_creates_no_account(client):
    """A link minted for alice@ is refused once Alice@ has an account, so no second account appears"""
    await _seed_currency()
    await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "Alice@example.com"})

    resp = await client.post("/auth/signup/confirm", json={"token": _link_token("alice@example.com"), "new_password": _NEW_PASSWORD})

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid or expired confirmation link"
    assert [user.email for user in await _users()] == ["Alice@example.com"]
