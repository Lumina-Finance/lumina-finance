#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

set -a
source "$repo_root/backend/.env"
set +a
dev_pg_container="$(read_env_var "$dev_dir/.env" DEV_PG_CONTAINER)"
test_db_user="$(read_env_var "$repo_root/backend/tests/.env.test" DB_USER)"
test_db_password="$(read_env_var "$repo_root/backend/tests/.env.test" DB_PASSWORD)"

: "${DB_HOST:?DB_HOST is required in backend/.env}"
: "${DB_PORT:?DB_PORT is required in backend/.env}"
: "${DB_NAME:?DB_NAME is required in backend/.env}"
: "${DB_USER:?DB_USER is required in backend/.env}"
: "${DB_PASSWORD:?DB_PASSWORD is required in backend/.env}"
: "${dev_pg_container:?DEV_PG_CONTAINER is required in dev/.env}"
: "${test_db_user:?DB_USER is required in backend/tests/.env.test}"
: "${test_db_password:?DB_PASSWORD is required in backend/tests/.env.test}"

# Make sure the dev container is up before creating databases inside it
ensure_dev_db_container "$dev_pg_container" "$DB_HOST" "$DB_PORT" "$DB_PASSWORD"

# Create the development database and role, plus the pytest role with CREATEDB
# pytest creates and recreates its own per-worker test databases, so only the
# role needs to exist here
docker exec -i "$dev_pg_container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
CREATE ROLE "$DB_USER" WITH LOGIN PASSWORD '$DB_PASSWORD';
CREATE DATABASE "$DB_NAME" OWNER "$DB_USER";
CREATE ROLE "$test_db_user" WITH LOGIN CREATEDB PASSWORD '$test_db_password';
SQL
