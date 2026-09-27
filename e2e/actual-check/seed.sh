#!/usr/bin/env bash
# Seeds a fresh Actual Budget server with the check's budgets, then writes each budget's export and
# manifest, and the run details, to output/. Needs only Docker. ACTUAL_IMAGE and ACTUAL_IMAGE_TAG
# pick the server image, ACTUAL_API_VERSION the @actual-app/api release that writes the budgets,
# ACTUAL_PORT the port on 127.0.0.1, and KEEP_ACTUAL=1 leaves the server running afterwards
set -euo pipefail
cd "$(dirname "$0")"

# The importer's own limits, which the check holds Actual's packages to
constants=../../frontend/src/pages/imports/actual/constants.ts
newest_checked=$(sed -nE 's/^export const ACTUAL_NEWEST_CHECKED_MIGRATION = ([0-9]+)$/\1/p' "$constants")
zero_decimal=$(sed -nE "s/^export const ACTUAL_ZERO_DECIMAL_CURRENCIES = new Set\(\[(.*)\]\)$/\1/p" "$constants" | tr -d "' ")
if [ -z "$newest_checked" ] || [ -z "$zero_decimal" ]; then
  echo "Could not read the importer's constants from $constants" >&2
  exit 1
fi

compose() { docker compose -f compose.yaml --profile seed "$@"; }

compose down -v --remove-orphans
compose up -d --wait actual

# A fresh server has no password until it is bootstrapped with one, which gives the first token
server="http://127.0.0.1:${ACTUAL_PORT:-18091}"
if ! curl -fsS "$server/account/needs-bootstrap" | grep -q '"bootstrapped":false'; then
  echo "The Actual server was already bootstrapped" >&2
  exit 1
fi
password=$(openssl rand -hex 24)
token=$(curl -fsS -H 'Content-Type: application/json' -d "{\"password\":\"$password\"}" "$server/account/bootstrap" \
  | sed -nE 's/.*"token":"([^"]+)".*/\1/p')
if [ -z "$token" ]; then
  echo "The Actual server gave no token" >&2
  exit 1
fi

# Each export's metadata.json carries this token as its userId, so output/ holds it. It opens only
# the server this script started, and is dead once that server is taken down
rm -rf output
ACTUAL_SESSION_TOKEN="$token" \
  ACTUAL_NEWEST_CHECKED_MIGRATION="$newest_checked" \
  ACTUAL_ZERO_DECIMAL_CURRENCIES="$zero_decimal" \
  SEED_USER="$(id -u):$(id -g)" \
  compose run --rm seed

if [ "${KEEP_ACTUAL:-0}" != 1 ]; then
  compose down -v
fi
