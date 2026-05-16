SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

TESTING_DIR ?= testing

.PHONY: reset-dev-db reset-docker-stack-test-db

# Reset the databases used for local development and pytest
reset-dev-db:
	@"$(TESTING_DIR)/reset-dev-db.sh"

# Rebuild and reset the local Docker-stack test instance
reset-docker-stack-test-db:
	@"$(TESTING_DIR)/reset-docker-stack-test-db.sh"
