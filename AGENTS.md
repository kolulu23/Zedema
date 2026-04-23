# Zedema - Project Zomboid Modding

## Project Type

Project Zomboid mod workspace for [Build 42](https://pzwiki.net/wiki/Build_42) workshop items.

## Directory Structure

```
WorkshopItem/              # One workshop item per game modpack
  Contents/
    mods/
      ModName/             # One mod (can have multiple per workshop item)
        common/            # MANDATORY folder (even if empty), stores large assets
          media/           # Shared assets (models, textures, animations)
        42/                # Version folder for B42
          mod.info         # Build 42 mod metadata
          poster.png       # Mod manager image
          media/
            lua/           # B42 scripts (client/server/shared)
            scripts/       # B42 script definitions
```

**Important**: 
- `common/` folder is **required** for B42 mods to be detected
- File/folder names must be lowercase for macOS/Linux compatibility
- Non-`Contents/` folders in workshop item are ignored by game (safe for git/IDE configs)

## Key Paths

- `Umbrella/` - Lua API type stubs (git submodule, read-only in VSCode)
- `zombie/` - Decompiled Java game source for reference (gitignored)
- `pzmc-template/` - Community mod template (git submodule)
- `.env` - Set `ZED_CACHE_DIR` and `ZED_MEDIA_DIR` for deploy scripts

## PZWiki Reference

### Media Folder Structure (`{42|common}/media/`)

Each subfolder serves a specific purpose. Files with matching relative paths to vanilla **override** the originals.

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

- **Override by path**: Place a file at the same relative path inside your mod's `media/` folder (e.g. `media/scripts/newitems.txt`)
- **New items/icons**: Icons go in `media/textures/` and must be named `item_<IconName>.png`. Subfolder paths work: `Icon = sub/MyIcon` → `media/textures/item_sub/MyIcon.png`
- **Soft overrides**: Item and craftRecipe blocks merge when redefined (parameters you don't specify are kept)
- **File overrides**: Naming a `.txt` script file the same relative path as vanilla **replaces the entire file** - avoid this, use soft overrides instead
- **Texture pack extraction**: Vanilla icons are in `ProjectZomboid/media/texturepacks/UI2.pack` - use a Pack Viewer tool to extract PNGs

### Asset Format Requirements

- **Textures**: 8bit PNG only (16bit rejected)
- **Models**: `.fbx` (recommended), `.glb`, or `.x` (legacy, not recommended)
- **Sounds**: `.ogg` or `.wav`
- **Videos**: `.bik` format (manual install only)

### Finding Game Assets

- **Game files**: `Steam/steamapps/common/ProjectZomboid/`
- **Game scripts/assets**: `ProjectZomboid/media/`
- **Java source**: `ProjectZomboid/zombie/` (decompile to understand internal behavior)
- **Console log**: `%UserProfile%/Zomboid/console.txt` (SP) - contains `print()` output and errors
- **Cache folder**: `%UserProfile%/Zomboid/` - can be changed via `-cachedir=<path>` startup parameter

### API Reference Resources

- **JavaDocs** (official): https://projectzomboid.com/modding/ - Exposed Java classes and methods
- **LuaDocs** (unofficial): Community Lua API reference, functions like JavaDocs but for Lua
- **ScriptsDocs** / **PZ Scripts Data**: Complete API reference for all zedscript blocks and parameters
- **Decompiling game code**: Use tools like JADX or similar to understand internal game behavior when docs are incomplete

### Lua Events (Entry Points)

Most Lua code starts by hooking into events. Key events:
- `OnGameStart` - Save loaded
- `OnTick` - Every game tick
- `OnPlayerUpdate` - Per player per tick
- `OnZombieUpdate` - Per zombie per tick
- `OnKeyPressed` / `OnKeyRelease` - Keyboard input
- `OnClientCommand` - Server receives client command
- `OnServerCommand` - Client receives server command

Full event list: https://pzwiki.net/wiki/Category:Lua_events

### Networking (B42.13+)

Since 42.13, server handles player damage, item stats, etc. Use commands for client ↔ server sync:

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

Commands only carry plain data (strings, booleans, numbers, tables) - no Java object instances. Pass player references via `onlineID` (`player:getOnlineID()` → `getPlayerByOnlineID(id)`).

### UI Creation

UI elements derive from `ISUIElement`/`ISPanel`. Always put UI code in `lua/client/`.

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

Text-based data definitions in `media/scripts/` (`.txt` files). Key rules:
- Comments: `/* ... */` (multiline only, `//` does NOT work)
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

When Umbrella type stubs are incomplete, consult these external resources:

### Official Documentation
- **JavaDocs**: https://projectzomboid.com/modding/ - Official Java class/method documentation
- **PZWiki**: https://pzwiki.net/wiki/Modding - Wiki for guides and explanations

### Unofficial Documentation
- **LuaDocs**: Community-maintained Lua API reference, structured like JavaDocs but for Lua
- **ScriptsDocs** / **PZ Scripts Data**: Complete zedscript block parameter reference
- **Decompiled source** (`zombie/`): Search Java files to understand internal game behavior

### Finding Information
1. Start with Umbrella type stubs in `Umbrella/library/lua/{client,server,shared}/`
2. Check LuaDocs for Lua-specific API functions and events
3. Consult JavaDocs for Java class methods exposed to Lua
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
```

## mod.info Format

```ini
id=ModId
name=DisplayName
poster=poster.png
tags=Build 42
versionMin=42.0
```

**Location**: Must be in version folder (e.g., `42/mod.info`), NOT at mod root

**Required fields**: Only `id` and `name` are mandatory, others optional

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
2. Decompiled Java in `zombie/` shows actual implementation - use when Umbrella lacks definitions or documentation
3. Lua scripts go in `ModName/42/media/lua/{client,server,shared}/` or `ModName/common/media/lua/{client,server,shared}/`

## Client/Server/Shared Directory Roles

Lua files are loaded based on which folder they're in (`media/lua/client/`, `media/lua/server/`, `media/lua/shared/`):

| Folder | Singleplayer | MP Client | MP Server |
|--------|-------------|-----------|-----------|
| `client` | ✓ | ✓ | ✗ |
| `server` | ✓ | ✓ | ✓ |
| `shared` | ✓ | ✓ | ✓ |

**Shared (`shared/`)**:
- Loaded on BOTH client and server in multiplayer
- Use for core game logic that needs to run everywhere
- Most common location for mod logic

**Client (`client/`)**:
- NOT loaded on the MP server side
- Use for UI elements, rendering, client-side input handling
- Safe for ISUI classes without affecting server
- **Pitfall**: Code here won't run on dedicated server hosts

**Server (`server/`)**:
- Loaded everywhere despite the name (singleplayer, MP client, MP server)
- Use for multiplayer-specific code that needs access on both sides
- Commonly used with PZ's networking APIs for RPCs and sync
- **Pitfall**: Don't put actual server-only logic here - guard it with `isServer()` checks

**Key Rule**: The folder only controls **loading**. For actual client/server behavior separation, use runtime checks like `isClient()` and `isServer()` within your Lua code.
