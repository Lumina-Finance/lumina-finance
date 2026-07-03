#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

# The restored staging dump arrives at migration head with its ACLs stripped, so the
# bootstrap RLS migration never re-runs and the app role keeps no table grants. Re-apply
# row-level security from the app source so the development database matches production
( cd "$repo_root/backend" && .venv/bin/python -m app.db.provision apply-rls )
