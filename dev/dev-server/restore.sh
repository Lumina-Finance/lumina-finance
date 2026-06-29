#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

ssh_host="$(read_env_var "$dev_dir/.env" DEV_VM_SSH_HOST)"
deploy_dir="$(read_env_var "$dev_dir/.env" DEV_VM_DEPLOY_DIR)"

: "${ssh_host:?DEV_VM_SSH_HOST is required in dev/.env}"
: "${deploy_dir:?DEV_VM_DEPLOY_DIR is required in dev/.env}"

# Bring up Postgres and wait for it to be healthy before restoring
dev_vm_compose "$ssh_host" "$deploy_dir" up -d --wait postgres

# Stream the remote dump through this machine into the dev server Postgres service,
# which restores using its own POSTGRES_* role and database from the host env
"$dev_dir/fetch-remote-dump.sh" \
	| ssh "$ssh_host" "cd '$deploy_dir' && docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner --no-acl -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"'"
