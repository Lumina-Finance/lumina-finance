#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

# Runs the Firefly III CLI export inside the container and copies the CSV
# files next to this script for importer development and verification

FIREFLY_CONTAINER="${FIREFLY_CONTAINER:-firefly-iii}"

# The range must cover the whole seeded window including the opening balance
# journals dated just before the first seeded month
EXPORT_START="${EXPORT_START:-2023-01-01}"
EXPORT_END="${EXPORT_END:-2026-07-12}"

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

mkdir -p "$output_dir"
docker cp "$FIREFLY_CONTAINER:$container_export_dir/." "$output_dir"
ls -la "$output_dir"
