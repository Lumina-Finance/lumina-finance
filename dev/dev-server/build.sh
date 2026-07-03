#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

docker_context="$(read_env_var "$dev_dir/.env" DEV_VM_DOCKER_CONTEXT)"
image="$(read_env_var "$dev_dir/.env" DEV_VM_IMAGE)"

: "${docker_context:?DEV_VM_DOCKER_CONTEXT is required in dev/.env}"
: "${image:?DEV_VM_IMAGE is required in dev/.env}"

# Tag the build with the current commit, marking a dirty tree so the running
# image always reflects exactly what was built from the working copy
app_version="$(git -C "$repo_root" rev-parse --short HEAD)"
if [ -n "$(git -C "$repo_root" status --porcelain)" ]; then
	app_version="${app_version}-dirty"
fi

# Build on the dev server daemon over the Docker context so the local working
# tree, including local-only branches, is streamed without placing source on the host
cd "$repo_root"
docker --context "$docker_context" build \
	--build-arg "APP_VERSION=$app_version" \
	-f docker/Dockerfile \
	-t "$image" .
