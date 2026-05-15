#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/.."

set -a
source "$script_dir/.env"
set +a

TEST_INSTANCE_IMAGE="${TEST_INSTANCE_IMAGE:-lumina-finance:testing}"
TEST_INSTANCE_PROJECT="${TEST_INSTANCE_PROJECT:-lumina-testing}"

# Recreate the local test stack and image from scratch.
docker compose --env-file "$script_dir/.env" -p "$TEST_INSTANCE_PROJECT" -f "$script_dir/compose.yml" down -v --remove-orphans
docker image rm -f "$TEST_INSTANCE_IMAGE" 2>/dev/null || true
docker build -f docker/Dockerfile -t "$TEST_INSTANCE_IMAGE" .

# Start only Postgres so the remote dump can be restored before app migrations run.
docker logout docker.io
docker compose --env-file "$script_dir/.env" -p "$TEST_INSTANCE_PROJECT" -f "$script_dir/compose.yml" up -d postgres
ssh "$REMOTE_SSH_HOST" "docker exec \"$REMOTE_DB_CONTAINER\" sh -lc 'pg_dump -Fc --no-owner --no-acl -U \"\${POSTGRES_USER}\" -d \"\${POSTGRES_DB}\"'" \
	| docker exec -i lumina-finance-db sh -lc 'pg_restore --clean --if-exists --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# Start the app so its entrypoint runs migrations against the restored database.
docker compose --env-file "$script_dir/.env" -p "$TEST_INSTANCE_PROJECT" -f "$script_dir/compose.yml" up -d app
