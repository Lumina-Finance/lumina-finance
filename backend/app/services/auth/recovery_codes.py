"""Recovery code generation and single-use redemption"""

import secrets
import uuid
from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import RecoveryCode
from app.services.auth.token_hashing import hash_token

# BIP-39 English wordlist, vendored from bitcoin/bips bip-0039/english.txt
_WORDLIST_PATH = Path(__file__).parent / "bip39_english.txt"
_EXPECTED_WORD_COUNT = 2048
_WORDS = _WORDLIST_PATH.read_text().split()

# Fail loudly if the vendored list is truncated, since that would silently weaken every code
if len(_WORDS) != _EXPECTED_WORD_COUNT:
    raise RuntimeError(f"Expected {_EXPECTED_WORD_COUNT} recovery words, found {len(_WORDS)}")

_RECOVERY_CODE_COUNT = 6
_WORDS_PER_CODE = 4
_RECOVERY_CODE_DIGITS = 3


def _build_recovery_code() -> str:
    """Return one recovery code as four words and a zero-padded number, joined by hyphens"""
    words = "-".join(secrets.choice(_WORDS) for _ in range(_WORDS_PER_CODE))
    number = secrets.randbelow(10**_RECOVERY_CODE_DIGITS)
    return f"{words}-{number:0{_RECOVERY_CODE_DIGITS}d}"


async def delete_recovery_codes(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Delete every recovery code for the user

    The caller commits so disabling and regenerating stay atomic with their other changes

    Args:
        db: Active database session
        user_id: User whose codes are cleared
    """
    await db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user_id))


async def delete_pending_recovery_codes(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Delete only the staged recovery codes, leaving any active batch in force

    The caller commits, so discarding a stale staged batch stays atomic with starting a fresh enrolment

    Args:
        db: Active database session
        user_id: User whose staged codes are cleared
    """
    await db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user_id, RecoveryCode.pending.is_(True)))


async def generate_recovery_codes(db: AsyncSession, user_id: uuid.UUID, *, pending: bool = False) -> list[str]:
    """Issue a fresh batch of recovery codes and return the plaintext

    The plaintext is shown to the user once and never stored, only the hashes are kept. A pending
    batch is staged for enrolment and leaves any active batch usable until completion, while a
    non-pending batch replaces the whole set at once. The caller commits

    Args:
        db: Active database session
        user_id: User receiving the codes
        pending: Whether to stage the batch as pending rather than replace the active set

    Returns:
        The plaintext recovery codes to display once
    """
    if pending:
        # Replace only a prior staged batch so the active codes keep working until completion
        await delete_pending_recovery_codes(db, user_id)
    else:
        await delete_recovery_codes(db, user_id)

    codes = [_build_recovery_code() for _ in range(_RECOVERY_CODE_COUNT)]
    for code in codes:
        db.add(RecoveryCode(user_id=user_id, code_hash=hash_token(code), pending=pending))

    return codes


async def activate_pending_recovery_codes(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Promote the staged batch to active, discarding the superseded active codes

    The caller commits so promotion is atomic with enabling the new authenticator

    Args:
        db: Active database session
        user_id: User whose pending batch becomes active
    """
    await db.execute(
        delete(RecoveryCode).where(RecoveryCode.user_id == user_id, RecoveryCode.pending.is_(False))
    )
    await db.execute(
        update(RecoveryCode).where(RecoveryCode.user_id == user_id, RecoveryCode.pending.is_(True)).values(pending=False)
    )


async def has_pending_recovery_codes(db: AsyncSession, user_id: uuid.UUID) -> bool:
    """Return whether a staged batch exists, the signal that enrolment was confirmed

    Args:
        db: Active database session
        user_id: User to check

    Returns:
        Whether at least one pending recovery code exists
    """

    # Probe for a single row rather than counting the whole batch
    result = await db.execute(
        select(RecoveryCode.id).where(RecoveryCode.user_id == user_id, RecoveryCode.pending.is_(True)).limit(1)
    )
    return result.first() is not None


async def consume_recovery_code(db: AsyncSession, user_id: uuid.UUID, code: str) -> bool:
    """Redeem one active recovery code by deleting its row

    The delete is scoped by user and hash so a code is single use and cannot redeem against
    another user, and staged codes are excluded so they only work once activated. The caller commits

    Args:
        db: Active database session
        user_id: User redeeming the code
        code: Submitted recovery code

    Returns:
        Whether a matching active code existed and was claimed
    """
    result = await db.execute(
        delete(RecoveryCode).where(
            RecoveryCode.user_id == user_id,
            RecoveryCode.code_hash == hash_token(code),
            RecoveryCode.pending.is_(False),
        )
    )
    return result.rowcount == 1
