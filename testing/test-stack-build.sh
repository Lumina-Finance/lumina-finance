#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

app_version="$(read_env_var "$testing_dir/.env" APP_VERSION)"
app_image_tag="$(read_env_var "$testing_dir/.env" APP_IMAGE_TAG)"

: "${app_version:?APP_VERSION is required in testing/.env}"
: "${app_image_tag:?APP_IMAGE_TAG is required in testing/.env}"

# Build under the production image name with the local override tag so the reused
# compose file runs exactly what was just built
cd "$repo_root"
docker build --build-arg "APP_VERSION=$app_version" -f docker/Dockerfile -t "luminahq/lumina-finance:$app_image_tag" .
