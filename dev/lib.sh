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

# Bring the dev Postgres container up and wait until it accepts connections,
# creating it when missing and starting it when it exists but is stopped
ensure_dev_db_container() {
    local container="$1" db_host="$2" db_port="$3" db_password="$4"

    if [ -z "$(docker ps -q -f "name=^${container}$")" ]; then
        if [ -n "$(docker ps -aq -f "name=^${container}$")" ]; then

            # Container exists but is stopped
            docker start "$container" >/dev/null
        else

            # Container has never been created
            docker run -d \
                --name "$container" \
                --restart unless-stopped \
                -e POSTGRES_PASSWORD="$db_password" \
                -p "$db_host:$db_port:5432" \
                postgres:17 >/dev/null
        fi
    fi

    until docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; do
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
