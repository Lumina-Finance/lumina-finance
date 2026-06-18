#!/usr/bin/env bash

# Shared paths and helpers for the dev tooling scripts

dev_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$dev_dir/.." && pwd)"

# Print the value of KEY from a dotenv FILE in a subshell so no other variables
# leak into the caller, which keeps the dev and test DB_* names from colliding
read_env_var() {
    local file="$1" key="$2"
    ( set -a +u; source "$file"; printf '%s' "${!key-}" )
}

# Replace KEY's value in a dotenv FILE, or append KEY=VALUE when the key is absent
set_env_var() {
    local file="$1" key="$2" value="$3" tmp
    if grep -qE "^${key}=" "$file" 2>/dev/null; then
        tmp="$(mktemp)"
        sed "s|^${key}=.*|${key}=${value}|" "$file" >"$tmp"
        mv "$tmp" "$file"
    else
        printf '%s=%s\n' "$key" "$value" >>"$file"
    fi
}

# Bring the dev Postgres container up and wait until it accepts connections,
# creating it when missing and starting it when it exists but is stopped
ensure_dev_db_container() {
    local container="$1" db_host="$2" db_port="$3" db_user="$4" db_password="$5" db_name="$6"

    if [ -z "$(docker ps -q -f "name=^${container}$")" ]; then
        if [ -n "$(docker ps -aq -f "name=^${container}$")" ]; then

            # Container exists but is stopped
            docker start "$container" >/dev/null
        else

            # Initialize the admin role as the superuser and owner of the database
            # so the dev container mirrors the self-hosted one
            docker run -d \
                --name "$container" \
                --restart unless-stopped \
                -e POSTGRES_USER="$db_user" \
                -e POSTGRES_PASSWORD="$db_password" \
                -e POSTGRES_DB="$db_name" \
                -p "$db_host:$db_port:5432" \
                postgres:17 >/dev/null
        fi
    fi

    until docker exec "$container" pg_isready -U "$db_user" -d "$db_name" >/dev/null 2>&1; do
        sleep 1
    done
}

# Run docker compose for the local test stack, reusing the production compose
# file with the docker test-stack environment from dev/.env
compose_test_stack() {
    docker compose \
        --env-file "$dev_dir/.env" \
        -p lumina-test \
        -f "$repo_root/docker/compose.yml" \
        "$@"
}
