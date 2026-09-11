# Zedema - Project Zomboid Modding

## Project Type

Project Zomboid mod workspace for [Build 42](https://pzwiki.net/wiki/Build_42) workshop items.

## Directory Structure

```
WorkshopItem/              # One workshop item per game modpack
  Contents/
    mods/
      ModName/             # One mod (multiple allowed per workshop item)
        common/            # MANDATORY folder (even if empty); stores large assets
          media/           # Shared assets (models, textures, animations)
        42/                # Version folder for B42
          mod.info         # Build 42 mod metadata
          poster.png       # Mod manager image
          media/
            lua/           # B42 scripts (client/server/shared)
            scripts/       # B42 script definitions
```

**Important**:
- `common/` is **required** for B42 mods to be detected
- File/folder names must be lowercase (macOS/Linux compatibility)
- Non-`Contents/` folders in a workshop item are ignored by the game (safe for git/IDE configs)

## Key Paths

- `Umbrella/` — Lua API type stubs (git submodule, read-only in VSCode)
- `zombie/` — decompiled Java game source for reference (gitignored, script-managed)
- `pzmc-template/` — community mod template (git submodule)
- `.env` — sets `ZED_CACHE_DIR`, `ZED_MEDIA_DIR`, and API-ref automation options
- `.api-refs.json` — **committed** per-branch API pin (Umbrella tag + Java source version)
- `.api-cache/` — local cache of decompiled sources + decompiler binaries (gitignored)

## API Reference Versioning (Branch Workflow)

PZ updates often and APIs differ per version, so refs are pinned per branch.
Background, research and verification log: `docs/api-reference-automation-report.md`.

| Branch   | API references                                        |
|----------|-------------------------------------------------------|
| `main`   | Latest game API + latest decompiled source            |
| `42.13`  | Umbrella tag `42.13.0` + decompiled 42.13 sources     |
| `41`     | Umbrella tag `41.78.16` + decompiled 41.x sources     |

The pin lives in committed `.api-refs.json` + the `Umbrella` submodule pointer. `zombie/` and `.api-cache/` are local-only and are (re)materialized from the pin.

```bash
# Pin the current branch to a game version (or "latest")
sh scripts/update_api_reference.sh latest     # main
sh scripts/update_api_reference.sh 42.13      # version branch
sh scripts/update_api_reference.sh --no-java 42.13   # Lua stubs only

# One-time setup: auto-restore refs on branch switch / merge
sh scripts/install_git_hooks.sh

# Manually restore the refs pinned by the current branch (no decompiling)
sh scripts/restore_api_refs.sh
```

### How `update_api_reference.sh` works

1. **Resolve version** — maps the argument to the best Umbrella tag (`latest` → newest tag, `42.13` → `42.13.0`, `41` → `41.78.16`, `42.20.4` → nearest `42.20.0`)
2. **Lua API stubs** — checks out the tag in the `Umbrella` submodule ([PZ-Umbrella/Umbrella](https://github.com/PZ-Umbrella/Umbrella), per-version tags)
3. **Decompiled Java (`zombie/`)** — picks the matching [ZomboidDecompiler](https://github.com/demiurgeQuantified/ZomboidDecompiler) release (latest for 42.13.0+, v0.2.3 for older), then:
   - **decompiles** the locally installed game when it matches the target version (source of truth)
   - or **restores** from `.api-cache/sources/<version>/` (previous runs)
   - or **fetches** from `ZED_DECOMP_REMOTE` (optional decompiled-source repo)
4. **Records** the result in `.api-refs.json` — commit it (and the `Umbrella` pointer) so the pin travels with the branch

### Starting a version branch

```bash
git switch -c 42.13
sh scripts/update_api_reference.sh 42.13
git add .api-refs.json Umbrella
git commit -m "Pin API refs to 42.13"
```

Decompiling an old version requires that game build installed (Steam → Project Zomboid → Properties → Betas), a cached snapshot in `.api-cache/`, or `ZED_DECOMP_REMOTE` set in `.env`. The script says exactly what's missing.

### Reference stability (trust order)

1. **Umbrella stubs** — community-maintained, version-tagged, the de-facto standard; check here first
2. **Official JavaDocs** (https://projectzomboid.com/modding/) — authoritative but current version only
3. **PZWiki API docs** — https://pzwiki.net/wiki/Modding (Lua/Java/Scripts), notes per-build changes
4. **Local decompile (`zombie/`)** — decompiled by yourself from the exact build you target, via ZomboidDecompiler; most reliable for internals
5. **Third-party decompiled repos** — no actively maintained, version-tagged public repo exists; treat as unverified. Prefer your own `.api-cache/` snapshots (optionally synced to a private repo via `ZED_DECOMP_REMOTE`)

## PZWiki Reference

### Media Folder Structure (`{42|common}/media/`)

Files with relative paths matching vanilla ones **override** the originals.

| Folder | Purpose |
|--------|---------|
| `lua/client/` | Client-only Lua (UI, rendering, input) - NOT loaded on MP server |
| `lua/server/` | Lua loaded everywhere (SP, MP client, MP server) - use `isServer()`/`isClient()` for branching |
| `lua/shared/` | Lua loaded everywhere - core logic, definitions |
| `scripts/` | `.txt` zedscripts (items, recipes, vehicles, etc.) |
| `models_X/` | 3D models (`.x`, `.fbx`, `.glb`) |
| `textures/` | Texture PNGs (8bit only), UI images |
| `ui/` | UI element PNGs |
| `sound/` | Audio files (`.ogg`, `.wav`). `.bank` files cannot be loaded from mods |
| `clothing/` | Clothing item XML definitions with GUIDs |
| `anims_X/` | Animation files |
| `AnimSets/` | Animation trigger/parameter definitions (XML) |
| `maps/` | Custom map files and assets |

### Adding & Replacing Assets

- **Override by path**: place a file at the same relative path inside your mod's `media/` (e.g. `media/scripts/newitems.txt`)
- **New items/icons**: icons go in `media/textures/` named `item_<IconName>.png`; subfolder paths work: `Icon = sub/MyIcon` → `media/textures/item_sub/MyIcon.png`
- **Soft overrides**: redefined item/craftRecipe blocks merge; unspecified parameters are kept
- **File overrides**: naming a `.txt` script file the same relative path as vanilla **replaces the entire file** — avoid; use soft overrides instead
- **Texture pack extraction**: vanilla icons are in `ProjectZomboid/media/texturepacks/UI2.pack`; extract with a Pack Viewer tool

### Asset Format Requirements

- **Textures**: 8bit PNG only (16bit rejected)
- **Models**: `.fbx` (recommended), `.glb`, or `.x` (legacy, not recommended)
- **Sounds**: `.ogg` or `.wav`
- **Videos**: `.bik` (manual install only)

### Finding Game Assets

- **Game files**: `Steam/steamapps/common/ProjectZomboid/`
- **Game scripts/assets**: `ProjectZomboid/media/`
- **Java source**: `ProjectZomboid/zombie/` (decompile to understand internal behavior)
- **Console log**: `%UserProfile%/Zomboid/console.txt` (SP) — contains `print()` output and errors
- **Cache folder**: `%UserProfile%/Zomboid/` — movable via `-cachedir=<path>` startup parameter

### API Reference Resources

- **Umbrella** (Lua + Java stubs): https://github.com/PZ-Umbrella/Umbrella — version-tagged; used by `update_api_reference.sh`
- **JavaDocs** (official): https://projectzomboid.com/modding/ — exposed Java classes and methods
- **LuaDocs** (unofficial): community Lua API reference, like JavaDocs but for Lua
- **ScriptsDocs** / **PZ Scripts Data**: complete reference for all zedscript blocks and parameters
- **Decompiling game code**: use [ZomboidDecompiler](https://github.com/demiurgeQuantified/ZomboidDecompiler) (Vineflower-based, PZWiki-recommended); `sh scripts/update_api_reference.sh <version>` automates this

### Lua Events (Entry Points)

Lua code usually starts by hooking events. Key events:
- `OnGameStart` - Save loaded
- `OnTick` - Every game tick
- `OnPlayerUpdate` - Per player per tick
- `OnZombieUpdate` - Per zombie per tick
- `OnKeyPressed` / `OnKeyRelease` - Keyboard input
- `OnClientCommand` - Server receives client command
- `OnServerCommand` - Client receives server command

Full event list: https://pzwiki.net/wiki/Category:Lua_events

### Networking (B42.13+)

Since 42.13 the server handles player damage, item stats, etc. Sync client ↔ server via commands:

```lua
-- Client → Server
sendClientCommand("MyMod", "MyAction", {key = value})

Events.OnClientCommand.Add(function(module, command, playerObj, args)
    if module == "MyMod" and command == "MyAction" then
        -- playerObj is the sender IsoPlayer
    end
end)

-- Server → Client (all)
sendServerCommand("MyMod", "MyAction", {key = value})
-- Server → Specific client
sendServerCommand(playerObj, "MyMod", "MyAction", {key = value})

Events.OnServerCommand.Add(function(module, command, args)
    if module == "MyMod" and command == "MyAction" then
        -- handle on client
    end
end)
```

Commands only carry plain data (strings, booleans, numbers, tables) — no Java object instances. Pass player references via `onlineID` (`player:getOnlineID()` → `getPlayerByOnlineID(id)`).

### UI Creation

UI elements derive from `ISUIElement`/`ISPanel`; always put UI code in `lua/client/`.

```lua
---@class MyPanel : ISPanel
local MyPanel = ISPanel:derive("MyPanel")

function MyPanel:initialise()
    ISPanel.initialise(self)
    -- Add children: ISLabel, ISButton, etc.
end

function MyPanel:render()
    self:drawText("Hello", 0, 0, 1, 1, 1, 1, UIFont.Small)
end

function MyPanel:new(x, y, w, h)
    local o = ISPanel.new(self, x, y, w, h)
    return o
end

-- Show: local panel = MyPanel:new(100, 100, 200, 200); panel:initialise(); panel:addToUIManager()
-- Hide: panel:setVisible(false); panel:removeFromUIManager()
```

See https://pzwiki.net/wiki/User_Interface for details.

### Scripts (Zedscripts)

Text data definitions in `media/scripts/` (`.txt` files). Key rules:
- Comments: `/* ... */` (multiline only; `//` does NOT work)
- Every key-value line ends with `,` (including the last one)
- Module prefix: always reference as `Base.ItemName` or `MyModule.MyItem`
- Soft overrides supported for items and craftRecipes

```lua
module Base {
    item MyMod_MyItem {
        DisplayName = My Item,
        Type = Normal,
        Weight = 0.5,
        Icon = MyItemIcon,
    }
}
```

See https://pzwiki.net/wiki/Scripts for all block types.

## External API References

For gaps in Umbrella type stubs, consult:

### Official Documentation

- **JavaDocs**: https://projectzomboid.com/modding/ — official Java class/method documentation
- **PZWiki**: https://pzwiki.net/wiki/Modding — guides and explanations

### Unofficial Documentation

- **LuaDocs**: community Lua API reference, structured like JavaDocs but for Lua
- **ScriptsDocs** / **PZ Scripts Data**: complete zedscript block parameter reference
- **Decompiled source** (`zombie/`): search Java files to understand internal game behavior

### Finding Information

1. Start with Umbrella stubs in `Umbrella/library/lua/{client,server,shared}/`
2. Check LuaDocs for Lua-specific API functions and events
3. Consult JavaDocs for Java methods exposed to Lua in `Umbrella/library/java/`
4. Search `zombie/` decompiled source when documentation is unclear
5. Use PZWiki for modding guides, best practices, and examples

## Commands

```bash
# Create new workshop item from template
./scripts/create_workshop.sh "WorkshopName" ModId

# Add another mod to existing workshop
./scripts/add_mod.sh "WorkshopName" NewModId

# Deploy to local Zomboid workshop cache
./scripts/deploy_workshop.sh "WorkshopName"

# Pin API references (Umbrella stubs + decompiled java) for this branch
sh scripts/update_api_reference.sh latest    # or 42.13 / 41 / 41.78.16
sh scripts/restore_api_refs.sh               # restore pin from cache (no decompile)
sh scripts/install_git_hooks.sh              # auto-restore on branch switch
```

## mod.info Format

```ini
id=ModId
name=DisplayName
poster=poster.png
tags=Build 42
versionMin=42.0
```

**Location**: must be in the version folder (e.g., `42/mod.info`), NOT at mod root

**Required fields**: only `id` and `name` are mandatory; others optional

**Common fields**:
- `id` - Unique mod identifier (NOT Workshop ID)
- `name` - Display name in mod manager
- `author` - Author name
- `description` - Mod description (supports ISRichTextPanel tags)
- `poster` - Mod manager image (can use `../common/` path)
- `icon` - Small icon for mod list
- `modversion` - Mod version number
- `require` - Comma-separated required mod IDs
- `versionMin` / `versionMax` - Game version range (format: `build.major`, e.g., `42.0`)
- `category` - Filter category (map/vehicle/features/modpack)
- `loadModAfter` / `loadModBefore` - Load order control

## Editing Existing Mods

1. Check `Umbrella/library/lua/` for existing API patterns before writing new code
2. Decompiled Java in `zombie/` shows the actual implementation — use when Umbrella lacks definitions or documentation
3. Lua scripts go in `ModName/42/media/lua/{client,server,shared}/` or `ModName/common/media/lua/{client,server,shared}/`

## Client/Server/Shared Directory Roles

Loading depends on the folder: `media/lua/client/`, `media/lua/server/`, or `media/lua/shared/`.

| Folder | Singleplayer | MP Client | MP Server |
|--------|-------------|-----------|-----------|
| `client` | ✓ | ✓ | ✗ |
| `server` | ✓ | ✓ | ✓ |
| `shared` | ✓ | ✓ | ✓ |

**Shared (`shared/`)**:
- Loaded on both client and server in multiplayer
- Use for core game logic that needs to run everywhere
- Most common location for mod logic

**Client (`client/`)**:
- NOT loaded on the MP server side
- Use for UI, rendering, client-side input handling
- Safe for ISUI classes without affecting the server
- **Pitfall**: code here won't run on dedicated server hosts

**Server (`server/`)**:
- Loaded everywhere despite the name (SP, MP client, MP server)
- Use for multiplayer-specific code needing both sides
- Commonly used with PZ's networking APIs for RPCs and sync
- **Pitfall**: not server-only logic — guard with `isServer()` checks

**Key Rule**: the folder only controls **loading**. For actual client/server behavior separation, use runtime checks like `isClient()` and `isServer()` inside your Lua code.
