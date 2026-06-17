import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from dotenv import load_dotenv

_TESTS_DIR = Path(__file__).resolve().parent

# Load the committed test config so tests always target the throwaway test
# database, override=True wins over anything app config already loaded
load_dotenv(_TESTS_DIR / ".env.test", override=True)

# Layer local overrides such as a per-worktree DB port on top
load_dotenv(_TESTS_DIR / ".env.test.local", override=True)


def _ensure_test_jwt_keys() -> None:
    """Generate throwaway JWT signing keys when none are configured

    CI and a local .env.test.local can set the key paths explicitly and those
    are respected. Otherwise a fresh checkout or worktree generates its own
    ephemeral keys so the suite runs with no manual setup
    """
    keys_dir = _TESTS_DIR / ".keys"
    key_files = {
        "JWT_ACCESS_PRIVATE_KEY_PATH": keys_dir / "access_private.pem",
        "JWT_REFRESH_PRIVATE_KEY_PATH": keys_dir / "refresh_private.pem",
    }
    for env_var, key_path in key_files.items():
        if os.getenv(env_var):
            continue

        if not key_path.exists():
            keys_dir.mkdir(parents=True, exist_ok=True)
            private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            pem = private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
            key_path.write_bytes(pem)
            key_path.chmod(0o600)
        os.environ[env_var] = str(key_path)


# Keys must exist before app.config is imported, which reads them at module load
_ensure_test_jwt_keys()
