"""Application configuration

Every setting is read at import time from the process environment. This package initialiser
loads the backend's .env first, which Python runs before any submodule of the package, so a
submodule reading os.getenv at module scope always sees the file's values
"""

from pathlib import Path

from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(_BACKEND_DIR / ".env")
