#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

set -a
source "$repo_root/backend/.env"
set +a

# Reference data must exist before demo rows because accounts and transactions
# reference currencies and system categories, and both seeds are idempotent
cd "$repo_root/backend"
.venv/bin/python -m scripts.seed_currencies
.venv/bin/python -m scripts.seed_categories

# The demo seed lives in dev tooling rather than the backend package, so the
# backend import path is supplied explicitly
PYTHONPATH="$repo_root/backend" .venv/bin/python "$dev_dir/dev-db/seed_demo_data.py"
