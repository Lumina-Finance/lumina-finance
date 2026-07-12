#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

# The frontend address is taken as input so no machine addresses live in the
# repository, the app is assumed to already be running there
: "${URL:?Usage: URL=<host:port of the running frontend> THEME=<light|dark> make take-hero-image}"
: "${THEME:?THEME is required, light or dark}"

cd "$dev_dir/screenshots"

# First run installs the capture dependencies and browser, later runs reuse them
if [ ! -d node_modules ]; then
	npm install --no-fund --no-audit
fi
npx playwright install chromium

URL="$URL" THEME="$THEME" node hero.mjs
