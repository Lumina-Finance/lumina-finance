#!/usr/bin/env bash
set -e

# Rebuild the local Docker test image, restore remote data into its Postgres
# container, then start the app container so entrypoint migrations run.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/.."

source "$script_dir/.env"

# Recreate the Docker-stack test database and image from scratch.
docker compose --env-file "$script_dir/.env" -p "$TEST_INSTANCE_PROJECT" -f "$script_dir/compose.yml" down -v --remove-orphans
docker build --build-arg APP_VERSION=0.1.0 -f docker/Dockerfile -t "$TEST_INSTANCE_IMAGE" .

# Start only Postgres so the remote dump can be restored before app migrations run.
docker logout docker.io
docker compose --env-file "$script_dir/.env" -p "$TEST_INSTANCE_PROJECT" -f "$script_dir/compose.yml" up -d postgres
ssh "$REMOTE_SSH_HOST" "docker exec \"$REMOTE_DB_CONTAINER\" sh -lc 'pg_dump -Fc --no-owner --no-acl -U \"\${POSTGRES_USER}\" -d \"\${POSTGRES_DB}\"'" \
	| docker exec -i lumina-finance-docker-stack-test-db sh -lc 'pg_restore --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# Start the app so its entrypoint runs migrations and seeds against the restored database.
docker compose --env-file "$script_dir/.env" -p "$TEST_INSTANCE_PROJECT" -f "$script_dir/compose.yml" up -d app
