#!/usr/bin/env bash
# =============================================================================
# update_api_reference.sh — pin this branch's Project Zomboid API references.
#
# Usage:
#   sh scripts/update_api_reference.sh latest           # latest game API
#   sh scripts/update_api_reference.sh 42.13            # arbitrary version
#   sh scripts/update_api_reference.sh 41.78.16
#   sh scripts/update_api_reference.sh --no-java 42.13  # Lua API stubs only
#   sh scripts/update_api_reference.sh --help
#
# What it does:
#   1. Resolves the requested game version to the best matching tag of the
#      PZ-Umbrella/Umbrella Lua API stub repository.
#   2. Checks out that tag in the Umbrella git submodule.
#   3. Picks the matching ZomboidDecompiler release (latest for game
#      42.13.0+, v0.2.3 for older builds — per the tool's compatibility chart).
#   4. Materializes the decompiled Java reference in ./zombie/:
#        a. decompiled from the locally installed game when its version
#           matches the request (the "fresh" path);
#        b. otherwise restored from .api-cache/sources/<version>/ (previous
#           runs — copy that folder between machines if you like);
#        c. or fetched from a decompiled-source repository, when
#           ZED_DECOMP_REMOTE is configured.
#   5. Records the pin in .api-refs.json (game version, Umbrella tag/commit,
#      source mode) — commit that file (and the Umbrella submodule pointer) on
#      the branch so the pin travels with git.
#
# Branch workflow:
#   main        -> `sh scripts/update_api_reference.sh latest`
#   42.13       -> `sh scripts/update_api_reference.sh 42.13`
#   41          -> `sh scripts/update_api_reference.sh 41`
#
# Works with bash 3.2+ (macOS default `sh`). On Linux with dash as `sh`,
# run `bash scripts/update_api_reference.sh ...` instead.
# =============================================================================

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib_api_refs.sh"

NO_JAVA=0
TARGET=""

usage() {
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help) usage ;;
        --no-java) NO_JAVA=1 ;;
        --*)       die "Unknown option: $1" ;;
        *)         TARGET="$1"; break ;;
    esac
    shift
done
[ -n "$TARGET" ] || { usage; exit 1; }

load_env
need_cmd git "Install git first."

# --- 1. resolve the Umbrella tag for the requested version -----------------
info "Querying $(umbrella_remote) for available version tags ..."
fetch_umbrella_refs
info "Resolving '$TARGET' ..."
UMBRELLA_TAG="$(resolve_umbrella_tag "$TARGET" "$UMBRELLA_TAGS")"

case "$UMBRELLA_TAG" in
    *.*.*) API_VERSION="$UMBRELLA_TAG" ;;
    *)     API_VERSION="$(stable_tag_to_version "$UMBRELLA_TAG")" ;;
esac
ok "Resolved '$TARGET' -> Umbrella tag $UMBRELLA_TAG (api version $API_VERSION)"

# --- 2. check out the tag in the Umbrella submodule ------------------------
update_umbrella "$UMBRELLA_TAG"
UMBRELLA_COMMIT="$(umbrella_commit)"

# --- 3. decompiled Java sources for zombie/ --------------------------------
SOURCE_MODE="absent"
GAME_VERSION=""
GAME_REVISION=""
DECOMP_RELEASE=""
DECOMP_COMPAT=""
GAME_DIR=""

if [ "$NO_JAVA" -eq 0 ]; then
    DECOMP_RELEASE="$(decompiler_release_for "$API_VERSION")"
    if [ "$DECOMP_RELEASE" = "latest" ]; then
        DECOMP_COMPAT="latest release (supports game 42.13.0+)"
    else
        DECOMP_COMPAT="$DECOMP_RELEASE (supports game up to 42.12.3)"
    fi

    GAME_DIR="$(find_game_java_dir | head -n 1 || true)"
    if [ -n "$GAME_DIR" ]; then
        GAME_VERSION="$(detect_game_version "$GAME_DIR")"
        GAME_REVISION="$(detect_game_revision "$GAME_DIR")"
        if [ -n "$GAME_VERSION" ]; then
            info "Installed game: $GAME_VERSION${GAME_REVISION:+ (svn r$GAME_REVISION)} in $GAME_DIR"
        fi
    fi
    [ -n "$GAME_VERSION" ] || warn "Could not detect an installed Project Zomboid (set ZED_GAME_DIR or ZED_MEDIA_DIR in .env)."

    CACHE_DIR="$(cache_source_path "$API_VERSION")"
    SRC=""
    MATCH="no"
    if [ -n "$GAME_DIR" ] && [ -n "$GAME_VERSION" ] \
       && [ "$(major_minor "$GAME_VERSION")" = "$(major_minor "$API_VERSION")" ]; then
        MATCH="yes"
    fi

    # 3a. fresh decompile when the installed game matches the target
    if [ "$MATCH" = "yes" ]; then
        DECOMP_BIN="$(ensure_decompiler "$DECOMP_RELEASE")"
        # surface the concrete release (e.g. v0.3.2) for the manifest
        if [ -f "$DECOMP_BIN/.release" ]; then
            CONCRETE_REL="$(cat "$DECOMP_BIN/.release")"
            [ "$CONCRETE_REL" != "latest" ] && DECOMP_RELEASE="$CONCRETE_REL"
        fi
        WORK="$(mktemp -d)"
        if SRC="$(decompile_game "$GAME_DIR" "$WORK/out" "$DECOMP_BIN/bin/ZomboidDecompiler" "$DECOMP_RELEASE")"; then
            rm -rf "$CACHE_DIR" && mkdir -p "$(dirname "$CACHE_DIR")"
            sync_dir "$SRC" "$CACHE_DIR"
            write_cache_meta "$API_VERSION" "$GAME_VERSION" "$GAME_REVISION" "$DECOMP_RELEASE"
            SOURCE_MODE="decompiled"
            ok "Decompiled ${GAME_VERSION} sources cached under $CACHE_DIR"
        else
            warn "Decompilation failed. Logs kept in $WORK/out.logs"
            die "Cannot produce java sources — fix the decompiler issue or use cache/remote."
        fi
    fi

    # 3b. cached sources from a previous run
    if [ -z "$SRC" ] && [ -d "$CACHE_DIR" ]; then
        info "Using cached sources: $CACHE_DIR"
        # trust the snapshot's recorded origin over the live install
        CACHE_GV="$(read_cache_meta_field "$API_VERSION" game_version)"
        CACHE_GR="$(read_cache_meta_field "$API_VERSION" game_revision)"
        if [ -n "$CACHE_GV" ]; then GAME_VERSION="$CACHE_GV"; fi
        if [ -n "$CACHE_GR" ]; then GAME_REVISION="$CACHE_GR"; fi
        SRC="$CACHE_DIR"
        SOURCE_MODE="cached"
    fi

    # 3c. decompiled-source repository
    if [ -z "$SRC" ] && [ -n "$DECOMP_REMOTE" ]; then
        if fetch_remote_sources "$API_VERSION" "$CACHE_DIR"; then
            write_cache_meta "$API_VERSION" "${GAME_VERSION:-unknown}" "${GAME_REVISION:-}" "remote"
            SRC="$CACHE_DIR"
            SOURCE_MODE="remote"
        fi
    fi

    if [ -z "$SRC" ]; then
        warn "No decompiled sources available for $API_VERSION."
        if [ "$MATCH" = "no" ] && [ -n "$GAME_VERSION" ]; then
            warn "Installed game is $GAME_VERSION — it does not match $API_VERSION."
        fi
        warn "Options:"
        warn "  1. Install/downgrade the game at $API_VERSION"
        warn "     (Steam -> Project Zomboid -> Properties -> Betas), then re-run."
        warn "  2. Run this script on a machine with $API_VERSION installed,"
        warn "     then copy .api-cache/sources/$API_VERSION over."
        warn "  3. Set ZED_DECOMP_REMOTE in .env to a decompiled-source repository,"
        warn "     then re-run."
        warn "Continuing with Lua API stubs only (zombie/ left untouched)."
    else
        mkdir -p "$ZOMBIE_DIR"
        sync_dir "$SRC" "$ZOMBIE_DIR"
        write_marker "$ZOMBIE_DIR" "$API_VERSION" "$SOURCE_MODE" "$GAME_VERSION" "$GAME_REVISION"
        ok "zombie/ now matches $API_VERSION ($SOURCE_MODE)"
    fi
else
    info "--no-java: skipping decompiled sources."
fi

# --- 4. manifest + summary -------------------------------------------------
write_manifest() {
    printf '{\n' > "$MANIFEST_FILE"
    printf '  "schema": 2,\n' >> "$MANIFEST_FILE"
    printf '  "requested": "%s",\n' "$TARGET" >> "$MANIFEST_FILE"
    printf '  "resolved_api_version": "%s",\n' "$API_VERSION" >> "$MANIFEST_FILE"
    printf '  "umbrella": {\n' >> "$MANIFEST_FILE"
    printf '    "remote": "%s",\n' "$(umbrella_remote)" >> "$MANIFEST_FILE"
    printf '    "tag": "%s",\n' "$UMBRELLA_TAG" >> "$MANIFEST_FILE"
    printf '    "commit": "%s"\n' "$UMBRELLA_COMMIT" >> "$MANIFEST_FILE"
    printf '  },\n' >> "$MANIFEST_FILE"
    printf '  "decompiler": {\n' >> "$MANIFEST_FILE"
    printf '    "release": "%s",\n' "$DECOMP_RELEASE" >> "$MANIFEST_FILE"
    printf '    "compatibility": "%s"\n' "$DECOMP_COMPAT" >> "$MANIFEST_FILE"
    printf '  },\n' >> "$MANIFEST_FILE"
    printf '  "java_source": {\n' >> "$MANIFEST_FILE"
    printf '    "mode": "%s",\n' "$SOURCE_MODE" >> "$MANIFEST_FILE"
    printf '    "game_version": "%s"\n' "$GAME_VERSION" >> "$MANIFEST_FILE"
    printf '  },\n' >> "$MANIFEST_FILE"
    printf '  "updated_at": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$MANIFEST_FILE"
    printf '}\n' >> "$MANIFEST_FILE"
}
write_manifest
ok "Wrote $MANIFEST_FILE"

cat <<EOF

  API references pinned to $API_VERSION
    Umbrella stubs : tag $UMBRELLA_TAG @ ${UMBRELLA_COMMIT:0:8}
    Java source    : ${SOURCE_MODE}${GAME_VERSION:+ (game $GAME_VERSION${GAME_REVISION:+ r$GAME_REVISION})}
    Decompiler     : ${DECOMP_RELEASE:-n/a} ${DECOMP_COMPAT:+- $DECOMP_COMPAT}

  Commit the pin on this branch:
    git add .api-refs.json Umbrella
    git commit -m "Pin API refs to $TARGET"

  On every other checkout/clone, .api-refs.json drives the restore:
    sh scripts/restore_api_refs.sh          # manual restore
    sh scripts/install_git_hooks.sh         # auto-restore on branch switch
EOF

if [ ! -x "$REPO_ROOT/.git/hooks/post-checkout" ]; then
    warn "Tip: run 'sh scripts/install_git_hooks.sh' once to auto-restore refs on branch switches."
fi
