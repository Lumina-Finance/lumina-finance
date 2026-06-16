#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

set -a
source "$repo_root/backend/.env"
set +a

# Bring the development database up to the current local migration head
cd "$repo_root/backend"
.venv/bin/alembic upgrade head
