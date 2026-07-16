#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

# Runs the Firefly III CLI export inside the container and copies the CSV
# files next to this script for importer development and verification

FIREFLY_CONTAINER="${FIREFLY_CONTAINER:-firefly-iii}"

# The CLI requires a range and quietly exports only what falls inside it, so
# these deliberately bracket any window the seed could produce rather than
# tracking its dates. Naming the seeded range here instead would leave two
# copies of it to keep in step, and the export would silently lose the years
# they disagreed on
EXPORT_START="${EXPORT_START:-2000-01-01}"
EXPORT_END="${EXPORT_END:-2099-12-31}"

container_export_dir="/tmp/firefly-export"
output_dir="$dev_dir/firefly-iii/exports"

# The CLI export authenticates with a per-user command line access token
# that fresh instances do not have yet, so create it and read it back from
# the user's preferences
docker exec "$FIREFLY_CONTAINER" php artisan correction:access-tokens
access_token="$(docker exec "$FIREFLY_CONTAINER" php -r '
    $pdo = new PDO("sqlite:/var/www/html/storage/database/database.sqlite");
    $row = $pdo->query("SELECT data FROM preferences WHERE user_id = 1 AND name = \"access_token\"")->fetch();
    echo json_decode($row[0]);
')"

docker exec "$FIREFLY_CONTAINER" sh -c "rm -rf $container_export_dir && mkdir -p $container_export_dir"
docker exec "$FIREFLY_CONTAINER" php artisan firefly-iii:export-data \
    --user=1 \
    --token="$access_token" \
    --export-transactions \
    --export-accounts \
    --export-budgets \
    --export-categories \
    --export-tags \
    --start="$EXPORT_START" \
    --end="$EXPORT_END" \
    --export_directory="$container_export_dir/"

# The files are named after the export date, so a stale run would otherwise
# leave a second dated set behind for the next reader to pick from
rm -rf "$output_dir"
mkdir -p "$output_dir"
docker cp "$FIREFLY_CONTAINER:$container_export_dir/." "$output_dir"
ls -la "$output_dir"
