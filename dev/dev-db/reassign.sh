#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

set -a
source "$repo_root/backend/.env"
set +a
dev_pg_container="$(read_env_var "$dev_dir/.env" DEV_PG_CONTAINER)"

: "${DB_NAME:?DB_NAME is required in backend/.env}"
: "${dev_pg_container:?DEV_PG_CONTAINER is required in dev/.env}"

# This role name is fixed in the application config and must match it
migrator_role="lumina_migrator"

# Hand every public table and sequence to the migrator, run as the superuser
# since changing ownership is owner-or-superuser only. Restored staging data is
# owned by the admin role, but the migrator must own it to enable row-level
# security and create policies, which are owner-only operations
docker exec -i "$dev_pg_container" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" <<SQL
DO \$\$
DECLARE
    object_name text;
BEGIN
    FOR object_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I OWNER TO "$migrator_role"', object_name);
    END LOOP;
    FOR object_name IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER SEQUENCE public.%I OWNER TO "$migrator_role"', object_name);
    END LOOP;
END
\$\$;
SQL
