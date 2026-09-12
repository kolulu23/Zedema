#!/usr/bin/env bash
# =============================================================================
# restore_api_refs.sh — materialize the API refs pinned by .api-refs.json.
#
# Usage:
#   sh scripts/restore_api_refs.sh           # manual
#   sh scripts/restore_api_refs.sh --quiet   # used by the git hooks
#
# Reads .api-refs.json from the current branch and:
#   1. checks out the recorded Umbrella tag in the submodule
#      (fetches it from the remote when needed);
#   2. restores zombie/ from .api-cache/sources/<version>/zombie,
#      or from ZED_DECOMP_REMOTE when the cache is empty.
#
# Never decompiles and never blocks a checkout — always exits 0.
# =============================================================================

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib_api_refs.sh"

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

load_env

if [ ! -f "$MANIFEST_FILE" ]; then
    [ "$QUIET" = 1 ] || info "No .api-refs.json on this branch — nothing to restore."
    exit 0
fi

API_VERSION="$(parse_manifest resolved_api_version)"
UMBRELLA_TAG="$(parse_manifest tag)"
SOURCE_MODE="$(parse_manifest mode)"
MANIFEST_GAME_VERSION="$(parse_manifest game_version)"

if [ -z "$API_VERSION" ]; then
    warn ".api-refs.json exists but has no resolved_api_version — run sh scripts/update_api_reference.sh."
    exit 0
fi

# --- 1. Umbrella submodule ------------------------------------------------
if [ -d "$UMBRELLA_DIR" ]; then
    SUB_STATE="$(git -C "$REPO_ROOT" submodule status Umbrella 2>/dev/null | cut -c1 || true)"
    case "$SUB_STATE" in
        -)
            info "Initializing Umbrella submodule..."
            git -C "$REPO_ROOT" submodule update --init Umbrella 2>/dev/null \
                || warn "git submodule update --init Umbrella failed."
            ;;
        +)
            info "Umbrella submodule differs from this branch's pin — checking out tag ${UMBRELLA_TAG:-?}."
            if [ -n "$UMBRELLA_TAG" ]; then
                git -C "$UMBRELLA_DIR" fetch --depth 1 origin "+refs/tags/$UMBRELLA_TAG:refs/tags/$UMBRELLA_TAG" >/dev/null 2>&1 \
                    || warn "Could not fetch Umbrella tag $UMBRELLA_TAG (offline?) — keeping current checkout."
                git -C "$UMBRELLA_DIR" checkout --detach "$UMBRELLA_TAG" >/dev/null 2>&1 \
                    || warn "Could not check out Umbrella tag $UMBRELLA_TAG."
            fi
            ;;
    esac
fi

# --- 2. decompiled Java sources --------------------------------------------
CURRENT="$(marker_api_version "$ZOMBIE_DIR")"
if [ "$CURRENT" = "$API_VERSION" ]; then
    [ "$QUIET" = 1 ] || ok "zombie/ already at $API_VERSION."
    exit 0
fi

CACHE_DIR="$(cache_source_path "$API_VERSION")"
RESTORED=0

if [ -d "$CACHE_DIR" ]; then
    mkdir -p "$ZOMBIE_DIR"
    sync_dir "$CACHE_DIR" "$ZOMBIE_DIR"
    # prefer the snapshot's recorded origin over the manifest fields
    CACHE_GV="$(read_cache_meta_field "$API_VERSION" game_version)"
    CACHE_GR="$(read_cache_meta_field "$API_VERSION" game_revision)"
    write_marker "$ZOMBIE_DIR" "$API_VERSION" "cached" \
        "${CACHE_GV:-$MANIFEST_GAME_VERSION}" "$CACHE_GR"
    ok "zombie/ restored to $API_VERSION from cache."
    RESTORED=1
elif [ -n "$DECOMP_REMOTE" ]; then
    if fetch_remote_sources "$API_VERSION" "$CACHE_DIR"; then
        mkdir -p "$ZOMBIE_DIR"
        sync_dir "$CACHE_DIR" "$ZOMBIE_DIR"
        write_marker "$ZOMBIE_DIR" "$API_VERSION" "remote" "$MANIFEST_GAME_VERSION" ""
        ok "zombie/ restored to $API_VERSION from $DECOMP_REMOTE."
        RESTORED=1
    fi
fi

if [ "$RESTORED" = 0 ]; then
    warn "This branch pins API version $API_VERSION, but zombie/ holds $CURRENT (or nothing)."
    warn "No cached snapshot found at $CACHE_DIR."
    warn "Run: sh scripts/update_api_reference.sh $API_VERSION"
    warn "  - it decompiles a matching local game install, or"
    warn "  - restores from cache / ZED_DECOMP_REMOTE when available."
fi

exit 0
