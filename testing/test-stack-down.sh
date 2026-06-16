#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Tear down the test stack and its volumes so the next run starts clean
compose_test_stack down -v --remove-orphans
