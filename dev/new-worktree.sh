#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

name="${1:-}"

: "${name:?Usage: make new-worktree NAME=<branch>}"

# Allow conventional branch names, the branch keeps the slashes while the slug
# replaces them so it is safe as a directory, container name, and port seed
if [[ ! "$name" =~ ^[a-z0-9]([a-z0-9/-]*[a-z0-9])?$ ]]; then
	echo "NAME must be lowercase letters, digits, hyphens, and slashes (e.g. feat/backend-rls)" >&2
	exit 1
fi

slug="${name//\//-}"

worktree="$repo_root/.worktree/$slug"
if [ -e "$worktree" ]; then
	echo "Worktree already exists: $worktree" >&2
	exit 1
fi

# One stable offset per name drives all three ports, so the same name always
# maps to the same trio and different worktrees never collide on the host
offset=$(( $(printf '%s' "$slug" | cksum | cut -d' ' -f1) % 1000 ))
db_port=$(( 55000 + offset ))
api_port=$(( 56000 + offset ))
web_port=$(( 57000 + offset ))
container="lumina-dev-$slug"

# Swap only the port in KEY's URL value, keeping whatever host is already set
set_url_port() {
	local file="$1" key="$2" port="$3" current
	current="$(grep -E "^${key}=" "$file" | head -1 | cut -d= -f2-)"
	set_env_var "$file" "$key" "$(printf '%s' "$current" | sed -E "s|(://[^:/]+):[0-9]+|\1:${port}|")"
}

# Create the worktree on a fresh branch from the current HEAD
git -C "$repo_root" worktree add -b "$name" "$worktree"

# Copy the gitignored env files so the worktree is a self-contained setup
for rel in backend/.env frontend/.env dev/.env backend/tests/.env.test.local; do
	if [ -f "$repo_root/$rel" ]; then
		mkdir -p "$(dirname "$worktree/$rel")"
		cp "$repo_root/$rel" "$worktree/$rel"
	fi
done

# Give this worktree its own database identity
set_env_var "$worktree/backend/.env" DB_PORT "$db_port"
set_env_var "$worktree/dev/.env" DEV_PG_CONTAINER "$container"

# The test suite layers .env.test.local over the committed .env.test, so the port
# must land here for backend tests to reach this worktree's isolated database
set_env_var "$worktree/backend/tests/.env.test.local" DB_PORT "$db_port"

# Point the app at this worktree's own server ports, the servers are launched by hand
set_url_port "$worktree/backend/.env" APP_URL "$web_port"
set_url_port "$worktree/frontend/.env" VITE_API_URL "$api_port"

# Install dependencies so the worktree is immediately runnable
( cd "$worktree/backend" && uv sync )
( cd "$worktree/frontend" && npm ci )

# Provision this worktree's database from staging and apply migrations
( cd "$worktree" && make reset-dev-db )

echo
echo "Worktree ready: $worktree"
echo "  branch     $name"
echo "  database   container $container on 127.0.0.1:$db_port"
echo "  backend    cd $worktree/backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $api_port"
echo "  frontend   cd $worktree/frontend && npm run dev -- --port $web_port"
