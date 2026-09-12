#!/usr/bin/env bash
# =============================================================================
# lib_api_refs.sh — shared helpers for update_api_reference.sh /
# restore_api_refs.sh. Sources this file, does not run standalone.
#
# Requires bash (3.2+). macOS `sh` is bash, so `sh scripts/....sh` works there.
# =============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
UMBRELLA_DIR="$REPO_ROOT/Umbrella"
ZOMBIE_DIR="$REPO_ROOT/zombie"
MANIFEST_FILE="$REPO_ROOT/.api-refs.json"

UMBRELLA_DEFAULT_REMOTE="https://github.com/PZ-Umbrella/Umbrella"
DECOMP_REPO="demiurgeQuantified/ZomboidDecompiler"
DECOMP_LATEST_URL="https://github.com/$DECOMP_REPO/releases/latest/download/ZomboidDecompiler.zip"
DECOMP_OLD_TAG="v0.2.3"                 # last release supporting game < 42.13.0
DECOMP_NEW_MIN_VERSION="42.13.0"        # latest releases support 42.13.0+

QUIET=0

# ---------------------------------------------------------------------------
# output helpers
# ---------------------------------------------------------------------------
info()  { [ "$QUIET" = 1 ] || printf '\033[1;34m[info]\033[0m %s\n' "$*"; }
ok()    { [ "$QUIET" = 1 ] || printf '\033[1;32m[ ok ]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[1;31m[err ]\033[0m %s\n' "$*" >&2; exit 1; }

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        die "Required command '$1' not found. $2"
    fi
}

# ---------------------------------------------------------------------------
# version helpers
# ---------------------------------------------------------------------------
# ver_cmp A B -> -1 (A<B), 0 (A==B), 1 (A>B). A/B are X.Y[.Z].
ver_cmp() {
    awk -v a="$1" -v b="$2" 'BEGIN {
        split(a, A, "."); split(b, B, ".");
        for (i = 1; i <= 3; i++) {
            ai = A[i] + 0; bi = B[i] + 0;
            if (ai > bi) { print 1;  exit }
            if (ai < bi) { print -1; exit }
        }
        print 0
    }'
}

major_minor() { printf '%s\n' "$1" | cut -d. -f1-2; }

# ---------------------------------------------------------------------------
# config / environment
# ---------------------------------------------------------------------------
load_env() {
    if [ -f "$REPO_ROOT/.env" ]; then
        # shellcheck disable=SC1091
        . "$REPO_ROOT/.env"
    fi
    API_CACHE="${ZED_API_CACHE_DIR:-$REPO_ROOT/.api-cache}"
    DECOMP_REMOTE="${ZED_DECOMP_REMOTE:-}"
}

# ---------------------------------------------------------------------------
# local game install detection
# ---------------------------------------------------------------------------
# Prints the directory containing the game classes (projectzomboid.jar or the
# zombie/*.class folder) — the path ZomboidDecompiler expects as input.
find_game_java_dir() {
    {
        [ -n "${ZED_GAME_DIR:-}" ]    && printf '%s\n' "$ZED_GAME_DIR"
        [ -n "${ZED_MEDIA_DIR:-}" ]   && printf '%s\n' "${ZED_MEDIA_DIR%/media}"
        [ -n "${ZED_MEDIA_DIR:-}" ]   && printf '%s\n' "$ZED_MEDIA_DIR"
        printf '%s\n' \
            "$HOME/Library/Application Support/Steam/steamapps/common/ProjectZomboid/Project Zomboid.app/Contents/Java" \
            "/Volumes/Game/SteamLibrary/steamapps/common/ProjectZomboid/Project Zomboid.app/Contents/Java" \
            "$HOME/.steam/steam/steamapps/common/ProjectZomboid" \
            "$HOME/.local/share/Steam/steamapps/common/ProjectZomboid" \
            "/Program Files (x86)/Steam/steamapps/common/ProjectZomboid" \
            "/Volumes/Game/SteamLibrary/steamapps/common/ProjectZomboid"
    } | while IFS= read -r c; do
        [ -n "$c" ] || continue
        c="$(cd "$c" 2>/dev/null && pwd)" || continue
        if [ -f "$c/projectzomboid.jar" ] || [ -d "$c/zombie" ]; then
            printf '%s\n' "$c"
        fi
    done | awk '!seen[$0]++'
}

# Prints "major.minor" of the installed game (e.g. 42.17); empty if unknown.
# Reads zombie.GitVersion.branchName (e.g. release_42_17).
detect_game_version() {
    local game_dir="$1" branch=""
    if [ -f "$game_dir/projectzomboid.jar" ]; then
        branch="$(unzip -p "$game_dir/projectzomboid.jar" zombie/GitVersion.class 2>/dev/null \
            | strings | grep -oE 'release_[0-9]+_[0-9]+' | head -n 1)"
    elif [ -f "$game_dir/zombie/GitVersion.class" ]; then
        branch="$(strings "$game_dir/zombie/GitVersion.class" | grep -oE 'release_[0-9]+_[0-9]+' | head -n 1)"
    fi
    if [ -n "$branch" ]; then
        printf '%s\n' "$branch" | sed -E 's/^release_([0-9]+)_([0-9]+)$/\1.\2/'
    fi
}

detect_game_revision() {
    local game_dir="$1"
    for f in "$game_dir/SVNRevision.txt" "$game_dir/../SVNRevision.txt" "$game_dir/../../SVNRevision.txt"; do
        if [ -f "$f" ]; then head -n 1 "$f" | tr -d '\r\n'; return 0; fi
    done
    echo ""
}

# ---------------------------------------------------------------------------
# Umbrella submodule / tag resolution
# ---------------------------------------------------------------------------
umbrella_remote() {
    git -C "$UMBRELLA_DIR" config --get remote.origin.url 2>/dev/null \
        || echo "$UMBRELLA_DEFAULT_REMOTE"
}

# fetch_umbrella_refs — queries the Umbrella remote once per run.
# Sets: UMBRELLA_RAW (full `git ls-remote --tags` output) and
#       UMBRELLA_TAGS (sorted ascending numeric X.Y.Z tags).
# Retries a few times (GitHub throttles unauthenticated requests) and falls
# back to the last successful listing when the network is unavailable.
fetch_umbrella_refs() {
    local attempt raw="" cache_f
    [ -n "${API_CACHE:-}" ] || API_CACHE="$REPO_ROOT/.api-cache"
    cache_f="$API_CACHE/umbrella-tags.cache"

    for attempt in 1 2 3; do
        raw="$(git ls-remote --tags "$(umbrella_remote)" 2>/dev/null)" && break
        info "Tag listing attempt $attempt failed — retrying in ${attempt}0s..."
        sleep "$((attempt * 10))"
    done

    if [ -z "$raw" ]; then
        if [ -f "$cache_f" ]; then
            warn "Cannot reach $(umbrella_remote) — using cached tag list (may be stale)."
            raw="$(cat "$cache_f")"
        else
            die "Cannot list tags of $(umbrella_remote) — check network access."
        fi
    else
        mkdir -p "$API_CACHE" 2>/dev/null || true
        printf '%s\n' "$raw" > "$cache_f" 2>/dev/null || true
    fi

    UMBRELLA_RAW="$raw"
    UMBRELLA_TAGS="$(printf '%s\n' "$raw" \
        | awk '{print $2}' \
        | sed 's|^refs/tags/||' \
        | grep -v '\^{}' \
        | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
        | sort -t. -k1,1n -k2,2n -k3,3n -u)"
}

# resolve_umbrella_tag <target> <numeric-tags> -> tag name
resolve_umbrella_tag() {
    local target="$1" tags="$2" tag best=""

    case "$target" in
        latest)
            best="$(printf '%s\n' "$tags" | tail -n 1)"
            ;;
        stable|unstable)
            if printf '%s\n' "$UMBRELLA_RAW" | grep -q "refs/tags/$target"; then
                best="$target"
            fi
            ;;
        *)
            if [ -z "$(printf '%s\n' "$target" | grep -E '^[0-9]+(\.[0-9]+){0,2}$')" ]; then
                die "Cannot parse version '$target' — expected latest, stable, or X / X.Y / X.Y.Z."
            fi
            if printf '%s\n' "$tags" | grep -qx "$target"; then
                best="$target"                                   # exact tag
            else
                case "$target" in
                    *.*.*)  # X.Y.Z -> highest tag with same X.Y and patch <= Z
                        local xy="${target%.*}"
                        for tag in $tags; do
                            case "$tag" in
                                "$xy".*)
                                    if [ "$(ver_cmp "$tag" "$target")" != "1" ] \
                                       && { [ -z "$best" ] || [ "$(ver_cmp "$tag" "$best")" = "1" ]; }; then
                                        best="$tag"
                                    fi
                                    ;;
                            esac
                        done
                        ;;
                    *.*)    # X.Y -> exact X.Y.0 first, else highest X.Y.*
                        if printf '%s\n' "$tags" | grep -qx "$target.0"; then
                            best="$target.0"
                        else
                            for tag in $tags; do
                                case "$tag" in "$target".*) best="$tag";; esac
                            done
                        fi
                        ;;
                    *)      # X -> highest X.*.*
                        for tag in $tags; do
                            case "$tag" in "$target".*) best="$tag";; esac
                        done
                        ;;
                esac
            fi
            ;;
    esac

    if [ -z "$best" ]; then
        warn "No Umbrella tag matches '$target'."
        warn "Available version tags:"
        printf '%s\n' "$tags" | sed 's/^/    /' >&2
        die "Pick one of the listed versions."
    fi
    echo "$best"
}

# Maps a moving tag (stable/unstable) to the numeric version tag at the same
# commit, so caches/manifests stay keyed by game version.
stable_tag_to_version() {
    local tag="$1" commit ver
    commit="$(printf '%s\n' "$UMBRELLA_RAW" | awk -v t="$tag" '$2=="refs/tags/"t"^{}" {print $1; exit}')"
    if [ -n "$commit" ]; then
        ver="$(printf '%s\n' "$UMBRELLA_RAW" \
            | awk -v c="$commit" '$1==c && $2 ~ /refs\/tags\/[0-9]+\.[0-9]+\.[0-9]+\^\{\}$/ {
                  n=$2; sub(/^refs\/tags\//, "", n); sub(/\^\{\}$/, "", n); print n
              }' \
            | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)"
    fi
    echo "${ver:-$tag}"
}

update_umbrella() {
    local tag="$1"
    need_cmd git "Install git first."
    if [ ! -d "$UMBRELLA_DIR/.git" ] && [ ! -f "$UMBRELLA_DIR/.git" ]; then
        info "Umbrella submodule not checked out — running git submodule update --init"
        ( cd "$REPO_ROOT" && git submodule update --init Umbrella )
    fi
    info "Fetching Umbrella tag $tag ..."
    if ! git -C "$UMBRELLA_DIR" fetch --depth 1 origin "+refs/tags/$tag:refs/tags/$tag" 2>/dev/null; then
        sleep 10
        git -C "$UMBRELLA_DIR" fetch --depth 1 origin "+refs/tags/$tag:refs/tags/$tag" \
            || die "Fetching Umbrella tag '$tag' failed — check network access."
    fi
    git -C "$UMBRELLA_DIR" checkout --detach "$tag" 2>/dev/null \
        || git -C "$UMBRELLA_DIR" checkout "$tag" \
        || die "Cannot check out Umbrella tag '$tag'. Is the submodule clean?"
    ok "Umbrella stubs at tag $tag"
}

umbrella_commit() {
    git -C "$UMBRELLA_DIR" rev-parse HEAD 2>/dev/null || echo ""
}

# ---------------------------------------------------------------------------
# ZomboidDecompiler
# ---------------------------------------------------------------------------
decompiler_release_for() {
    local version="$1"
    if [ "$(ver_cmp "$version" "$DECOMP_NEW_MIN_VERSION")" != "-1" ]; then
        echo "latest"      # resolved to a concrete release at download time
    else
        echo "$DECOMP_OLD_TAG"
    fi
}

# ensure_decompiler <latest|vX.Y.Z> -> prints dir containing bin/ZomboidDecompiler
ensure_decompiler() {
    local rel dir url tag zipfile tmpdir one
    rel="$1"
    dir="$API_CACHE/decompiler/$rel"
    if [ -x "$dir/bin/ZomboidDecompiler" ]; then
        echo "$dir"; return 0
    fi
    need_cmd curl "Install curl first."
    need_cmd unzip "Install unzip first."

    if [ "$rel" = "latest" ]; then
        url="$DECOMP_LATEST_URL"
        tag="$(curl -fsSL "https://api.github.com/repos/$DECOMP_REPO/releases/latest" 2>/dev/null \
               | grep -o '"tag_name": *"[^"]*"' | head -n 1 | cut -d'"' -f4 || echo latest)"
        # remember the concrete release for the manifest
        [ "$tag" != "latest" ] && rel="$tag"
    else
        url="https://github.com/$DECOMP_REPO/releases/download/$rel/ZomboidDecompiler.zip"
        tag="$rel"
    fi

    dir="$API_CACHE/decompiler/$rel"
    if [ -x "$dir/bin/ZomboidDecompiler" ]; then
        echo "$dir"; return 0
    fi

    info "Downloading ZomboidDecompiler $tag from $DECOMP_REPO ..." >&2
    tmpdir="$(mktemp -d)"
    zipfile="$tmpdir/ZomboidDecompiler.zip"
    curl -fsSL --retry 3 -o "$zipfile" "$url" \
        || die "Download of ZomboidDecompiler failed ($url)."
    unzip -q -o "$zipfile" -d "$tmpdir/extracted" \
        || die "Extracting ZomboidDecompiler.zip failed."
    one="$tmpdir/extracted"
    [ -d "$one/ZomboidDecompiler" ] && one="$one/ZomboidDecompiler"
    rm -rf "$dir" && mkdir -p "$dir"
    mv "$one"/* "$dir/"
    chmod +x "$dir/bin/ZomboidDecompiler" 2>/dev/null || true
    rm -rf "$tmpdir"
    ok "ZomboidDecompiler $tag ready in $dir" >&2
    echo "$dir"
}

# ---------------------------------------------------------------------------
# decompiled Java source
# ---------------------------------------------------------------------------
# Finds the decompiled zombie/ package inside a decompiler output tree.
locate_zombie_src() {
    local out="$1"
    [ -d "$out/zombie" ]        && { echo "$out/zombie";        return 0; }
    [ -d "$out/source/zombie" ] && { echo "$out/source/zombie"; return 0; }
    find "$out" -maxdepth 4 -type d -name zombie 2>/dev/null \
        | while IFS= read -r d; do
            if [ -n "$(find "$d" -name '*.java' -print -quit 2>/dev/null)" ]; then
                echo "$d"; break
            fi
        done
}

# decompile_game <game_dir> <out_dir> <decompiler_bin> <release> -> src dir
# Prints ONLY the source dir on stdout (everything else goes to stderr).
decompile_game() {
    local game_dir="$1" out="$2" bin="$3" rel="$4" src extra=""
    rm -rf "$out" "$out.logs" && mkdir -p "$out" "$out.logs"

    [ "${ZED_DECOMP_ADD_DOCSTRINGS:-1}" = "1" ] && extra="--add-docstrings"

    info "Decompiling $game_dir (ZomboidDecompiler $rel — takes a few minutes)..." >&2
    "$bin" "$game_dir" "$out" "--log-path=$out.logs" $extra 2>&1 | tail -n 3 >&2 || true

    src="$(locate_zombie_src "$out")"
    if [ -z "$src" ] && [ -n "$extra" ]; then
        warn "No output with docstrings enabled — retrying without --add-docstrings."
        rm -rf "$out" && mkdir -p "$out"
        "$bin" "$game_dir" "$out" "--log-path=$out.logs" 2>&1 | tail -n 3 >&2 || true
        src="$(locate_zombie_src "$out")"
    fi
    if [ -z "$src" ]; then
        warn "Decompiler produced no zombie/ sources. See $out.logs for details."
        return 1
    fi
    echo "$src"
}

# fetch_remote_sources <version> <dest> — clones $DECOMP_REMOTE into dest.
fetch_remote_sources() {
    local version="$1" dest="$2" ref tried="" clone_dir src
    [ -n "$DECOMP_REMOTE" ] || return 1
    need_cmd git "Install git first."
    clone_dir="$(mktemp -d)"

    for ref in "$version" "${version%.*}" "${version%%.*}"; do
        if git ls-remote --heads --tags "$DECOMP_REMOTE" "refs/heads/$ref" "refs/tags/$ref" 2>/dev/null | grep -q .; then
            tried="$ref"; break
        fi
    done

    info "Fetching decompiled sources from $DECOMP_REMOTE (ref: ${tried:-default branch})..."
    if [ -n "$tried" ]; then
        git clone --depth 1 --branch "$tried" "$DECOMP_REMOTE" "$clone_dir" 2>/dev/null || true
    fi
    if [ ! -d "$clone_dir/zombie" ] && [ -z "$tried" ]; then
        git clone --depth 1 "$DECOMP_REMOTE" "$clone_dir" 2>/dev/null || true
    fi

    src="$(find "$clone_dir" -maxdepth 3 -type d -name zombie 2>/dev/null | head -n 1)"
    if [ -z "$src" ]; then
        # repo may hold the sources at its root
        src="$clone_dir"
    fi
    if [ -n "$(find "$src" -name '*.java' -print -quit 2>/dev/null)" ]; then
        rm -rf "$dest" && mkdir -p "$dest"
        sync_dir "$src" "$dest"
        rm -rf "$clone_dir"
        warn "Sources fetched from a third-party repo — verify they really match $version."
        return 0
    fi
    rm -rf "$clone_dir"
    return 1
}

cache_source_path() { echo "$API_CACHE/sources/$1/zombie"; }

# Per-version cache metadata: remembers which game install a snapshot came from.
cache_meta_file() { echo "$API_CACHE/sources/$1/meta.json"; }

write_cache_meta() { # <version> <game_version> <game_revision> <decompiler_release>
    local meta
    meta="$(cache_meta_file "$1")"
    mkdir -p "$(dirname "$meta")"
    printf '{\n  "game_version": "%s",\n  "game_revision": "%s",\n  "decompiler_release": "%s",\n  "created_at": "%s"\n}\n' \
        "$2" "$3" "$4" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$meta"
}

read_cache_meta_field() { # <version> <field>
    local meta
    meta="$(cache_meta_file "$1")"
    [ -f "$meta" ] || { echo ""; return 0; }
    grep -m1 "\"$2\"" "$meta" | sed -E 's/^[^:]*:[[:space:]]*"([^"]*)".*$/\1/'
}

# ---------------------------------------------------------------------------
# markers / manifest
# ---------------------------------------------------------------------------
write_marker() { # <zombie_dir> <api_version> <source_mode> <game_version> <game_revision>
    printf '{\n  "api_version": "%s",\n  "source": "%s",\n  "game_version": "%s",\n  "game_revision": "%s",\n  "updated_at": "%s"\n}\n' \
        "$2" "$3" "$4" "$5" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$1/.source.json"
}

marker_api_version() { # <zombie_dir>
    [ -f "$1/.source.json" ] || { echo ""; return 0; }
    grep -m1 '"api_version"' "$1/.source.json" | sed -E 's/^[^:]*:[[:space:]]*"([^"]*)".*$/\1/'
}

parse_manifest() { # <field>
    [ -f "$MANIFEST_FILE" ] || { echo ""; return 0; }
    grep -m1 "\"$1\"" "$MANIFEST_FILE" | sed -E 's/^[^:]*:[[:space:]]*"([^"]*)".*$/\1/'
}

# Portable dir sync: make $2 identical to $1 (keeps $2/.source.json if present).
sync_dir() {
    local src="$1" dst="$2"
    if [ ! -d "$src" ]; then die "sync_dir: source missing: $src"; fi
    mkdir -p "$dst"
    if command -v rsync >/dev/null 2>&1; then
        rsync -a --delete --exclude='.source.json' "$src/" "$dst/"
    else
        rm -rf "$dst" && mkdir -p "$dst" && cp -R "$src"/. "$dst"/
    fi
}
