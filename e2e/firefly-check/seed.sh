#!/usr/bin/env bash
# Seeds a fresh Firefly III with the check's dataset, then writes its exports, run details and
# manifest to output/. Needs only Docker. FIREFLY_VERSION picks the image tag, FIREFLY_PORT the
# port on 127.0.0.1, and KEEP_FIREFLY=1 leaves the instance running afterwards
set -euo pipefail
cd "$(dirname "$0")"

compose() { docker compose -f compose.yaml --profile seed "$@"; }

compose down -v --remove-orphans
compose up -d --wait firefly

# A fresh instance has no personal access client, and a user made outside the web sign-up has no
# user group until the database correction gives it one
compose exec -T firefly php artisan passport:client --personal --name="Import check" --provider=users --no-interaction >/dev/null
token=$(compose exec -T firefly php < make-token.php | grep -E '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' | tail -n 1 || true)
if [ -z "$token" ]; then
  echo "Firefly III gave no API token" >&2
  exit 1
fi
compose exec -T firefly php artisan firefly-iii:correct-database >/dev/null

# The token only ever lives in this process's environment, never in output/
rm -rf output
FIREFLY_TOKEN="$token" SEED_USER="$(id -u):$(id -g)" compose run --rm seed

if [ "${KEEP_FIREFLY:-0}" != 1 ]; then
  compose down -v
fi
