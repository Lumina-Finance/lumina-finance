SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

DEV_DIR ?= dev

.PHONY: new-worktree cleanup-worktree \
	reset-dev-db dev-db-recreate dev-db-create dev-db-restore dev-db-reassign dev-db-migrate dev-db-apply-rls \
	reset-dev-server dev-server-down dev-server-build dev-server-restore dev-server-app-up

# Create a fully isolated worktree with its own database, dependencies, and port
new-worktree:
	@"$(DEV_DIR)/new-worktree.sh" "$(NAME)"

# Remove the current worktree, its branch, and its database container
cleanup-worktree:
	@"$(DEV_DIR)/cleanup-worktree.sh"

# Reset the databases used for local development and pytest
reset-dev-db: dev-db-recreate dev-db-create dev-db-restore dev-db-reassign dev-db-migrate dev-db-apply-rls

# Recreate the local development Postgres container
dev-db-recreate:
	@"$(DEV_DIR)/dev-db/recreate.sh"

# Create the development and pytest databases and roles
dev-db-create:
	@"$(DEV_DIR)/dev-db/create.sh"

# Restore remote staging data into the development database
dev-db-restore:
	@"$(DEV_DIR)/dev-db/restore.sh"

# Hand restored tables to the migrator role before migrations run
dev-db-reassign:
	@"$(DEV_DIR)/dev-db/reassign.sh"

# Apply local migrations to the development database
dev-db-migrate:
	@"$(DEV_DIR)/dev-db/migrate.sh"

# Re-apply row-level security so the restored dump regains its app role grants
dev-db-apply-rls:
	@"$(DEV_DIR)/dev-db/apply-rls.sh"

# Rebuild and reset the remote dev server from a fresh production snapshot. The app
# entrypoint provisions roles, transfers ownership, migrates, re-applies row-level
# security, and seeds, so no separate grant-rebuild step is needed here
reset-dev-server: dev-server-down dev-server-build dev-server-restore dev-server-app-up

# Tear down the dev server stack and its volumes
dev-server-down:
	@"$(DEV_DIR)/dev-server/down.sh"

# Build the app image on the dev server daemon from the local working tree
dev-server-build:
	@"$(DEV_DIR)/dev-server/build.sh"

# Start the dev server Postgres and restore remote production data into it
dev-server-restore:
	@"$(DEV_DIR)/dev-server/restore.sh"

# Start the dev server app so its entrypoint migrates, re-applies RLS, and seeds
dev-server-app-up:
	@"$(DEV_DIR)/dev-server/app-up.sh"
