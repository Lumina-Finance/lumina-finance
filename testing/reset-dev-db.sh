#!/usr/bin/env bash
set -e

# Recreate the local development Postgres container, restore remote data,
# create the pytest database, then apply local Alembic migrations.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/.."

source "$script_dir/.env"
source .env

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:?DB_PORT is required}"
: "${DB_NAME:?DB_NAME is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${DEV_PG_CONTAINER:?DEV_PG_CONTAINER is required}"
: "${TEST_DB_NAME:?TEST_DB_NAME is required}"
: "${TEST_DB_USER:?TEST_DB_USER is required}"
: "${TEST_DB_PASSWORD:?TEST_DB_PASSWORD is required}"
: "${REMOTE_SSH_HOST:?REMOTE_SSH_HOST is required}"
: "${REMOTE_DB_CONTAINER:?REMOTE_DB_CONTAINER is required}"

# Recreate the local Postgres container from scratch.
docker stop "$DEV_PG_CONTAINER" >/dev/null 2>&1 || true
docker rm "$DEV_PG_CONTAINER" >/dev/null 2>&1 || true
docker run -d \
	--name "$DEV_PG_CONTAINER" \
	--restart unless-stopped \
	-e POSTGRES_PASSWORD="$DB_PASSWORD" \
	-p "$DB_HOST:$DB_PORT:5432" \
	postgres:17

# Wait for the new container before creating the local databases.
until docker exec "$DEV_PG_CONTAINER" pg_isready -U postgres -d postgres; do
	sleep 1
done

# Create the development and pytest databases and users.
docker exec -i "$DEV_PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
CREATE ROLE "$DB_USER" WITH LOGIN PASSWORD '$DB_PASSWORD';
CREATE DATABASE "$DB_NAME" OWNER "$DB_USER";
CREATE ROLE "$TEST_DB_USER" WITH LOGIN CREATEDB PASSWORD '$TEST_DB_PASSWORD';
CREATE DATABASE "$TEST_DB_NAME" OWNER "$TEST_DB_USER";
SQL

# Stream a remote dump into the local development database.
ssh "$REMOTE_SSH_HOST" "docker exec \"$REMOTE_DB_CONTAINER\" sh -lc 'pg_dump -Fc --no-owner --no-acl -U \"\${POSTGRES_USER}\" -d \"\${POSTGRES_DB}\"'" \
	| docker exec -i "$DEV_PG_CONTAINER" pg_restore --no-owner --no-acl -U "$DB_USER" -d "$DB_NAME"

# Bring the copied database up to the current local migration head.
(
	cd backend
	DB_HOST="$DB_HOST" \
		DB_PORT="$DB_PORT" \
		DB_NAME="$DB_NAME" \
		DB_USER="$DB_USER" \
		DB_PASSWORD="$DB_PASSWORD" \
		.venv/bin/alembic upgrade head
)
