#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Stream the remote dump into the stack Postgres service, which restores using
# its own POSTGRES_* role and database from testing/.env
"$testing_dir/fetch-remote-dump.sh" \
	| compose_test_stack exec -T postgres sh -lc 'pg_restore --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
