#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

set -a
source "$repo_root/backend/.env"
set +a
dev_pg_container="$(read_env_var "$dev_dir/.env" DEV_PG_CONTAINER)"

: "${DB_HOST:?DB_HOST is required in backend/.env}"
: "${DB_PORT:?DB_PORT is required in backend/.env}"
: "${DB_PASSWORD:?DB_PASSWORD is required in backend/.env}"
: "${dev_pg_container:?DEV_PG_CONTAINER is required in dev/.env}"

# Tear down any existing container and its data volume so it is rebuilt clean
docker stop "$dev_pg_container" >/dev/null 2>&1 || true
docker rm -v "$dev_pg_container" >/dev/null 2>&1 || true

ensure_dev_db_container "$dev_pg_container" "$DB_HOST" "$DB_PORT" "$DB_PASSWORD"
