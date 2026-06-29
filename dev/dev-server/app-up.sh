#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

ssh_host="$(read_env_var "$dev_dir/.env" DEV_VM_SSH_HOST)"
deploy_dir="$(read_env_var "$dev_dir/.env" DEV_VM_DEPLOY_DIR)"

: "${ssh_host:?DEV_VM_SSH_HOST is required in dev/.env}"
: "${deploy_dir:?DEV_VM_DEPLOY_DIR is required in dev/.env}"

# Start the app so its entrypoint provisions roles, transfers ownership, migrates,
# re-applies row-level security, and seeds against the restored database
dev_vm_compose "$ssh_host" "$deploy_dir" up -d app

# The entrypoint does all of that before it serves, so wait until the app answers
# before returning, confirming the provisioning finished rather than just the container start
readiness_check="import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
for _ in $(seq 1 60); do
	if ssh "$ssh_host" "cd '$deploy_dir' && docker compose exec -T app python -c \"$readiness_check\"" >/dev/null 2>&1; then
		exit 0
	fi
	sleep 2
done

echo "dev server app did not become ready within the timeout" >&2
exit 1
