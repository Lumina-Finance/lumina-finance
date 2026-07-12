#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

# Captures need the backend to share the pinned calendar day the seed and the
# capture browser use, so this starts the app with its data clock pinned
: "${PORT:?Usage: PORT=<port> dev/screenshots/run-pinned-backend.sh}"

cd "$repo_root/backend"
exec env PYTHONPATH="$repo_root/backend" .venv/bin/python "$dev_dir/screenshots/pinned_backend.py" --port "$PORT"
