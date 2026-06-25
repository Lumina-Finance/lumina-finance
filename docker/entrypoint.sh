#!/usr/bin/env bash
set -euo pipefail

export RUNTIME="${RUNTIME:-server}"
export JWT_ACCESS_PRIVATE_KEY_PATH="${JWT_ACCESS_PRIVATE_KEY_PATH:-/data/keys/access_private.pem}"
export JWT_REFRESH_PRIVATE_KEY_PATH="${JWT_REFRESH_PRIVATE_KEY_PATH:-/data/keys/refresh_private.pem}"

ensure_private_key() {
	key_name="$1"
	key_path="$2"

	# Keep existing keys only if OpenSSL can parse and validate them
	if [ -e "$key_path" ] || [ -L "$key_path" ]; then
		if [ -s "$key_path" ] && openssl pkey -in "$key_path" -check -noout >/dev/null 2>&1; then
			return
		fi

		# Replace invalid or empty keys in place
		echo "${key_name} token signing key is invalid, removing and generating one..."
		rm -f "$key_path"
	else
		echo "${key_name} token signing key not found, generating one..."
	fi

	# Write to a temporary file first so partial key generation is never persisted
	mkdir -p "$(dirname "$key_path")"
	tmp_path="${key_path}.tmp"
	rm -f "$tmp_path"
	openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$tmp_path"
	chmod 600 "$tmp_path"
	mv "$tmp_path" "$key_path"
	echo "Generated ${key_name} token signing key at $key_path"
}

cleanup() {
	# Stop both child processes when the container receives a shutdown signal
	if [ -n "${backend_pid:-}" ]; then
		kill "$backend_pid" 2>/dev/null || true
	fi
	if [ -n "${caddy_pid:-}" ]; then
		kill "$caddy_pid" 2>/dev/null || true
	fi
}

trap cleanup INT TERM EXIT

ensure_private_key "Access" "$JWT_ACCESS_PRIVATE_KEY_PATH"
ensure_private_key "Refresh" "$JWT_REFRESH_PRIVATE_KEY_PATH"

# Create the migrator and app roles and hand them schema ownership while still
# connected as the admin role, before migrations run as the migrator
python -m app.db.provision ensure-roles
python -m app.db.provision transfer-ownership

# Run migrations and seed the database before starting the backend and Caddy
alembic upgrade head

# A restored backup arrives at migration head with its ACLs stripped so the bootstrap RLS
# migration never re-runs, this re-applies the policies and app role grants from the app
# source and is a no-op on a freshly migrated database
python -m app.db.provision apply-rls

python -m scripts.seed_currencies
python -m scripts.seed_categories

# Caddy serves the frontend and proxies /api to this local Uvicorn process
uvicorn app.main:app --host 127.0.0.1 --port 8000 &
backend_pid="$!"

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid="$!"

wait -n "$backend_pid" "$caddy_pid"
exit $?
