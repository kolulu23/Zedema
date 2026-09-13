#!/usr/bin/env sh
# Run a command with the local Playwright browser + the locally extracted
# system libraries on the path. Chromium is not installed system-wide in this
# sandbox, so both live inside the project:
#
#   .pw-browsers/   chromium (npx playwright install chromium)
#   .pw-libs/root/  shared libraries extracted from .deb packages
#
# Usage:  sh tools/pw.sh node tools/smoke.mjs
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
APP=$(dirname "$HERE")
export PLAYWRIGHT_BROWSERS_PATH="$APP/.pw-browsers"
export LD_LIBRARY_PATH="$APP/.pw-libs/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$@"
