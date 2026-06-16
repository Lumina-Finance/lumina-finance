SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

DEV_DIR ?= dev

.PHONY: reset-dev-db dev-db-recreate dev-db-create dev-db-restore dev-db-migrate \
	reset-test-stack test-stack-down test-stack-build test-stack-db-up test-stack-restore test-stack-app-up

# Reset the databases used for local development and pytest
reset-dev-db: dev-db-recreate dev-db-create dev-db-restore dev-db-migrate

# Recreate the local development Postgres container
dev-db-recreate:
	@"$(DEV_DIR)/dev-db/recreate.sh"

# Create the development and pytest databases and roles
dev-db-create:
	@"$(DEV_DIR)/dev-db/create.sh"

# Restore remote staging data into the development database
dev-db-restore:
	@"$(DEV_DIR)/dev-db/restore.sh"

# Apply local migrations to the development database
dev-db-migrate:
	@"$(DEV_DIR)/dev-db/migrate.sh"

# Rebuild and reset the local Docker test stack
reset-test-stack: test-stack-down test-stack-build test-stack-db-up test-stack-restore test-stack-app-up

# Tear down the test stack and its volumes
test-stack-down:
	@"$(DEV_DIR)/test-stack/down.sh"

# Build the test stack image
test-stack-build:
	@"$(DEV_DIR)/test-stack/build.sh"

# Start only the test stack Postgres
test-stack-db-up:
	@"$(DEV_DIR)/test-stack/db-up.sh"

# Restore remote staging data into the test stack database
test-stack-restore:
	@"$(DEV_DIR)/test-stack/restore.sh"

# Start the test stack app so its entrypoint migrates and seeds
test-stack-app-up:
	@"$(DEV_DIR)/test-stack/app-up.sh"
