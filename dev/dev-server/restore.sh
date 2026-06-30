#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

ssh_host="$(read_env_var "$dev_dir/.env" DEV_VM_SSH_HOST)"
deploy_dir="$(read_env_var "$dev_dir/.env" DEV_VM_DEPLOY_DIR)"

: "${ssh_host:?DEV_VM_SSH_HOST is required in dev/.env}"
: "${deploy_dir:?DEV_VM_DEPLOY_DIR is required in dev/.env}"

# Bring up Postgres and wait for it to be healthy before restoring
dev_vm_compose "$ssh_host" "$deploy_dir" up -d --wait postgres

# Reset the schema to empty before restoring. The data volume is a bind mount that "down -v" does not
# clear, so the database survives a reset, and a "--clean" restore only drops the objects the
# production dump contains. That cannot drop tables that exist only on the dev server (the newer auth
# migrations), and their foreign keys then block dropping the shared ones like users. Dropping the
# whole schema first removes the dev-only tables too, so the load always starts from a clean slate
ssh "$ssh_host" "cd '$deploy_dir' && docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;\"'"

# Stream the remote dump through this machine into the dev server Postgres service, which restores
# using its own POSTGRES_* role and database from the host env
"$dev_dir/fetch-remote-dump.sh" \
	| ssh "$ssh_host" "cd '$deploy_dir' && docker compose exec -T postgres sh -c 'pg_restore --no-owner --no-acl -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"'"
