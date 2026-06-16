from pathlib import Path

from dotenv import load_dotenv

_TESTS_DIR = Path(__file__).resolve().parent

# Load the committed test config so tests always target the throwaway test
# database, override=True wins over anything app config already loaded
load_dotenv(_TESTS_DIR / ".env.test", override=True)

# Layer machine-specific overrides such as absolute JWT key paths on top
load_dotenv(_TESTS_DIR / ".env.test.local", override=True)
