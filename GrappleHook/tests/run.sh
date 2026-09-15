#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
if [ -d /opt/nanobrew/prefix/Cellar/lua/5.5.1/lib ]; then
    export DYLD_LIBRARY_PATH="/opt/nanobrew/prefix/Cellar/lua/5.5.1/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
fi
for source in GrappleHook/Contents/mods/GrappleHook/42/media/lua/*/grapplehook/*.lua; do
    luac -p "$source"
done
lua GrappleHook/tests/lifecycle.lua
python3 GrappleHook/tests/validate.py
echo "grapple hook checks passed"
