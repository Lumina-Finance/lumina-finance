#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

# The frontend address is taken as input so no machine addresses live in the
# repository, the app is assumed to already be running there. PROD=1 records
# the polished slow-capture cut, anything else records a fast rough draft
: "${URL:?Usage: URL=<host:port of the running frontend> [PROD=1] make take-demo-video}"

cd "$dev_dir/screenshots"

# First run installs the capture dependencies and browser, later runs reuse them
if [ ! -d node_modules ]; then
	npm install --no-fund --no-audit
fi
npx playwright install chromium

URL="$URL" node record-demo.mjs
