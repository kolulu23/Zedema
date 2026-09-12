#!/usr/bin/env bash
# Installs git hooks that keep the API references in sync with the branch.
# Each hook simply delegates to scripts/restore_api_refs.sh --quiet, which
# is a fast no-op when the branch's refs are already materialized.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/.git/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
    echo "Not a git working tree (no .git/hooks) — aborting." >&2
    exit 1
fi

for hook in post-checkout post-merge; do
    cp "$SCRIPT_DIR/hooks/$hook" "$HOOKS_DIR/$hook"
    chmod +x "$HOOKS_DIR/$hook"
    echo "installed $HOOKS_DIR/$hook"
done

echo "Done. Branch switches and merges will now restore the pinned API refs."
