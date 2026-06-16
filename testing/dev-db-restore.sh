#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

set -a
source "$repo_root/backend/.env"
set +a
dev_pg_container="$(read_env_var "$testing_dir/.env" DEV_PG_CONTAINER)"

: "${DB_NAME:?DB_NAME is required in backend/.env}"
: "${DB_USER:?DB_USER is required in backend/.env}"
: "${dev_pg_container:?DEV_PG_CONTAINER is required in testing/.env}"

# Stream the remote dump straight into the development database
"$testing_dir/fetch-remote-dump.sh" \
	| docker exec -i "$dev_pg_container" pg_restore --no-owner --no-acl -U "$DB_USER" -d "$DB_NAME"
