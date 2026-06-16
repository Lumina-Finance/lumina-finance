#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Drop stale Docker Hub credentials so the public Postgres image pulls cleanly
docker logout docker.io

# Start only Postgres so the remote dump can be restored before app migrations run
compose_test_stack up -d postgres
