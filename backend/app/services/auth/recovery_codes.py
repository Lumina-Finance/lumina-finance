"""Recovery code generation and single-use redemption"""

import secrets
import uuid
from pathlib import Path

from sqlalchemy import delete, select
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


async def generate_recovery_codes(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    """Replace the user's recovery codes with a fresh batch and return the plaintext

    The plaintext is shown to the user once and never stored, only the hashes are kept. The
    caller commits so the batch is atomic with confirming or regenerating

    Args:
        db: Active database session
        user_id: User receiving the codes

    Returns:
        The plaintext recovery codes to display once
    """
    await delete_recovery_codes(db, user_id)

    codes = [_build_recovery_code() for _ in range(_RECOVERY_CODE_COUNT)]
    for code in codes:
        db.add(RecoveryCode(user_id=user_id, code_hash=hash_token(code)))

    return codes


async def has_recovery_codes(db: AsyncSession, user_id: uuid.UUID) -> bool:
    """Return whether the user has any recovery codes, the signal that enrolment was confirmed

    Args:
        db: Active database session
        user_id: User to check

    Returns:
        Whether at least one recovery code exists
    """

    # Probe for a single row rather than counting the whole batch
    result = await db.execute(select(RecoveryCode.id).where(RecoveryCode.user_id == user_id).limit(1))
    return result.first() is not None


async def consume_recovery_code(db: AsyncSession, user_id: uuid.UUID, code: str) -> bool:
    """Redeem one recovery code by deleting its row

    The delete is scoped by user and hash so a code is single use and cannot redeem against
    another user. The caller commits the surrounding transaction

    Args:
        db: Active database session
        user_id: User redeeming the code
        code: Submitted recovery code

    Returns:
        Whether a matching code existed and was claimed
    """
    result = await db.execute(
        delete(RecoveryCode).where(
            RecoveryCode.user_id == user_id,
            RecoveryCode.code_hash == hash_token(code),
        )
    )
    return result.rowcount == 1
