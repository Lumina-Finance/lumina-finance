#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

ssh_host="$(read_env_var "$dev_dir/.env" DEV_VM_SSH_HOST)"
deploy_dir="$(read_env_var "$dev_dir/.env" DEV_VM_DEPLOY_DIR)"

: "${ssh_host:?DEV_VM_SSH_HOST is required in dev/.env}"
: "${deploy_dir:?DEV_VM_DEPLOY_DIR is required in dev/.env}"

# Tear down the dev server stack and its volumes so the next run starts from a
# clean production snapshot
dev_vm_compose "$ssh_host" "$deploy_dir" down -v --remove-orphans
