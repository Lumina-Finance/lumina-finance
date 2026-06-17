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

# These role names are fixed in the application config and must match it
migrator_role="lumina_migrator"
app_role="lumina_app"

# Return KEY from the dev env file, generating and persisting a password when it
# is absent so the role keeps a stable credential across runs
# Dev runs the backend on the host where /data/secrets is not writable, so the
# passwords live in backend/.env and the app reads them from the environment, and
# the generator matches the one the app uses everywhere else
ensure_env_password() {
    local env_file="$1" key="$2" value
    value="$(read_env_var "$env_file" "$key")"
    if [ -z "$value" ]; then
        value="$(cd "$repo_root/backend" && .venv/bin/python -c 'from app.db.credentials import generate_password; print(generate_password())')"
        set_env_var "$env_file" "$key" "$value"
    fi
    printf '%s' "$value"
}

migrator_password="$(ensure_env_password "$backend_env" MIGRATOR_DB_PASSWORD)"
app_password="$(ensure_env_password "$backend_env" APP_DB_PASSWORD)"

# Make sure the dev container is up before creating roles and databases inside it
ensure_dev_db_container "$dev_pg_container" "$DB_HOST" "$DB_PORT" "$DB_PASSWORD"

# Create every role idempotently so the script can be re-run against an existing
# worktree to add the migrator and app roles without recreating the database
# The migrator owns the schema and runs migrations, the app role serves requests
# under row-level security, and the pytest role manages its own test databases
docker exec -i "$dev_pg_container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
        CREATE ROLE "$DB_USER" LOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$test_db_user') THEN
        CREATE ROLE "$test_db_user" LOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$migrator_role') THEN
        CREATE ROLE "$migrator_role" LOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$app_role') THEN
        CREATE ROLE "$app_role" LOGIN;
    END IF;
END
\$\$;

ALTER ROLE "$DB_USER" WITH LOGIN PASSWORD '$DB_PASSWORD';
ALTER ROLE "$test_db_user" WITH LOGIN CREATEDB PASSWORD '$test_db_password';
ALTER ROLE "$migrator_role" WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD '$migrator_password';
ALTER ROLE "$app_role" WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD '$app_password';
SQL

# Create the development database when missing, since CREATE DATABASE cannot run
# inside the idempotent role block above
if [ -z "$(docker exec "$dev_pg_container" psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" -U postgres -d postgres)" ]; then
    docker exec "$dev_pg_container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\""
fi

# Grant the migrator and app roles their baseline access inside the dev database
# The migrator creates and owns schema objects, the app role only connects and
# reads the schema, its table privileges arrive later with the RLS policies
docker exec -i "$dev_pg_container" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" <<SQL
GRANT CREATE, USAGE ON SCHEMA public TO "$migrator_role";
GRANT CONNECT ON DATABASE "$DB_NAME" TO "$app_role";
GRANT USAGE ON SCHEMA public TO "$app_role";
SQL
