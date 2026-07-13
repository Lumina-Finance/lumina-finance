#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

# The frontend address, screen size, and theme are taken as input so no
# machine addresses live in the repository, the app is assumed to already be
# running
usage="Usage: URL=<host:port of the running frontend> SIZE=<desktop|tablet|mobile> THEME=<light|dark> make take-screenshots"
: "${URL:?$usage}"
: "${SIZE:?$usage}"
: "${THEME:?$usage}"

cd "$dev_dir/screenshots"

# First run installs the capture dependencies and browser, later runs reuse them
if [ ! -d node_modules ]; then
	npm install --no-fund --no-audit
fi
npx playwright install chromium

URL="$URL" SIZE="$SIZE" THEME="$THEME" node capture.mjs
