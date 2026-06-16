#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Start the app so its entrypoint runs migrations and seeds against the restored database
compose_test_stack up -d app
