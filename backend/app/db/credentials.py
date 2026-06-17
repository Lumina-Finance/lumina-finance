"""Database role password resolution"""

import os
import secrets
from pathlib import Path

# --- Secret storage ---

# Fixed location for persisted password files
_SECRETS_DIR = Path("/data/secrets")

# Random password length range, short enough to fit a Postgres connection URL
_MIN_PASSWORD_LENGTH = 16
_MAX_PASSWORD_LENGTH = 20

# Owner-only read and write
_PASSWORD_FILE_MODE = 0o600


def resolve_role_password(role: str, *, generate: bool) -> str:
    """Return the password for a database role

    Resolution order is the environment variable, then the persisted file, then a
    freshly generated password when generation is allowed. The provisioner calls
    this with generation enabled so it can create the role and persist the secret,
    while the application reads the same value back without ever writing

    Args:
        role: Short role key such as migrator or app
        generate: Whether a missing password may be generated and persisted

    Returns:
        The resolved role password

    Raises:
        RuntimeError: No password is configured or persisted and generation is not allowed
    """
    env_var = f"{role.upper()}_DB_PASSWORD"
    configured_password = os.getenv(env_var)
    if configured_password:
        return configured_password

    password_file = _SECRETS_DIR / f"{role}_db_password"
    if password_file.exists():
        return password_file.read_text().strip()

    if not generate:
        raise RuntimeError(
            f"No password for the {role} database role. Set {env_var} or provision the role first"
        )

    # token_urlsafe over-produces characters, so slice to the chosen length
    password_length = _MIN_PASSWORD_LENGTH + secrets.randbelow(_MAX_PASSWORD_LENGTH - _MIN_PASSWORD_LENGTH + 1)
    generated_password = secrets.token_urlsafe(password_length)[:password_length]
    _SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    password_file.write_text(generated_password)
    password_file.chmod(_PASSWORD_FILE_MODE)
    return generated_password
