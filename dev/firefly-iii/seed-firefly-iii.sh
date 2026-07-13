#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

# Firefly III runs from a user-managed compose directory because it is a
# scratch instance for developing the importer, not part of the app stack
: "${FIREFLY_COMPOSE_DIR:?Set FIREFLY_COMPOSE_DIR to the directory holding the Firefly III docker-compose.yml}"

export FIREFLY_URL="${FIREFLY_URL:-http://localhost:8080}"

# Wipe the SQLite database and upload storage so the seed starts from a fresh
# instance, which keeps every generated id and value deterministic
cd "$FIREFLY_COMPOSE_DIR"
docker compose down
rm -rf data/database data/upload
mkdir -p data/database data/upload
docker compose up -d

# The container runs migrations on boot, so wait until the registration page
# answers before seeding
until curl -sfo /dev/null "$FIREFLY_URL/register"; do
    sleep 2
done

python3 "$dev_dir/firefly-iii/seed_firefly_iii.py"
