#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

backend_env="$repo_root/backend/.env"

set -a
source "$backend_env"
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

# Dev runs the backend on the host where /data/secrets is not writable, so the
# migrator and app passwords live in backend/.env and the app reads them from the
# environment, generated with the same helper the app uses everywhere else
ensure_env_password() {
    local env_file="$1" key="$2" value
    if [ -z "$(read_env_var "$env_file" "$key")" ]; then
        value="$(cd "$repo_root/backend" && .venv/bin/python -c 'from app.db.credentials import generate_password; print(generate_password())')"
        set_env_var "$env_file" "$key" "$value"
    fi
}

ensure_env_password "$backend_env" MIGRATOR_DB_PASSWORD
ensure_env_password "$backend_env" APP_DB_PASSWORD

# The container initializes DB_USER as the superuser and owner of DB_NAME
ensure_dev_db_container "$dev_pg_container" "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASSWORD" "$DB_NAME"

# The pytest role manages its own per-worker test databases, so it is the only
# role created here, the migrator and app roles come from the shared provisioner
docker exec -i "$dev_pg_container" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" <<SQL
DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$test_db_user') THEN
        CREATE ROLE "$test_db_user" LOGIN CREATEDB;
    END IF;
END \$\$;
ALTER ROLE "$test_db_user" WITH LOGIN CREATEDB PASSWORD '$test_db_password';
SQL

# Create the migrator and app roles and grant their baseline access, shared with
# the self-hosted container so role setup is identical everywhere
( cd "$repo_root/backend" && .venv/bin/python -m app.db.provision ensure-roles )

# Let the pytest role create parity databases owned by the migrator, which the
# migration schema-parity tests need since alembic runs as the migrator
docker exec -i "$dev_pg_container" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -c "GRANT \"$migrator_role\" TO \"$test_db_user\""
