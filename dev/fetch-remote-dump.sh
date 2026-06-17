#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Stream a compressed dump of the remote staging database to stdout so callers
# can pipe it into whichever local target they restore into
remote_ssh_host="$(read_env_var "$dev_dir/.env" REMOTE_SSH_HOST)"
remote_db_container="$(read_env_var "$dev_dir/.env" REMOTE_DB_CONTAINER)"

: "${remote_ssh_host:?REMOTE_SSH_HOST is required in dev/.env}"
: "${remote_db_container:?REMOTE_DB_CONTAINER is required in dev/.env}"

ssh "$remote_ssh_host" "docker exec \"$remote_db_container\" sh -lc 'pg_dump -Fc --no-owner --no-acl -U \"\${POSTGRES_USER}\" -d \"\${POSTGRES_DB}\"'"
