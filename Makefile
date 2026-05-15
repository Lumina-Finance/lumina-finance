SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

TESTING_DIR ?= testing

.PHONY: reset-test-instance

reset-test-instance:
	@"$(TESTING_DIR)/reset-test-instance.sh"
