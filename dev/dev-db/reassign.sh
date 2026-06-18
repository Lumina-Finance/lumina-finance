#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

# Hand restored tables to the migrator before migrations run, through the shared
# provisioner so dev and the self-hosted container use identical logic
( cd "$repo_root/backend" && .venv/bin/python -m app.db.provision transfer-ownership )
