"""Foreign exchange rate provider settings"""

import os

FRANKFURTER_URL = os.getenv("FRANKFURTER_URL", "https://api.frankfurter.dev/v2").strip().rstrip("/")
if not FRANKFURTER_URL:
    raise RuntimeError("FRANKFURTER_URL cannot be blank")
