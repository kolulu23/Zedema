# Zedema - Project Zomboid Modding

A Project Zomboid modding workspace built around the [Build 42](https://pzwiki.net/wiki/Build_42) workshop-item structure.

## Project Structure

```
Zedema/
├── Umbrella/             # Git submodule: Lua API type stubs
├── pzmc-template/        # Git submodule: Community mod template
├── MyExampleWorkshop/    # Workshop item project created from the template
├── zomboid/              # Decompiled game code (gitignored)
├── scripts/              # Automation and utility scripts
├── .env                  # Environment variables for local paths
├── .vscode/
│   ├── extensions.json   # Recommended VSCode extensions
│   └── settings.json     # Workspace settings (Umbrella configured)
```

## Prerequisites

### Required Software

- [Git](https://git-scm.com/)
- [Visual Studio Code](https://code.visualstudio.com/)
- Project Zomboid (Steam)

### VSCode Extensions

Install recommended extensions when prompted, or manually:

```json
{
  "recommendations": ["actboy168.lua-debug", "sumneko.lua"]
}
```

- **Lua Debug** (`actboy168.lua-debug`) - Debugger for Zomboid Lua code
- **Lua LS** (`sumneko.lua`) - Language server with Umbrella addon support

## Setup

### 1. Clone and Initialize Submodules

```bash
git clone <repository-url>
cd Zedema
git submodule update --init --recursive
```

### 2. Configure Umbrella (Lua Language Server)

This project includes [Umbrella](https://github.com/PZ-Umbrella/Umbrella) as a submodule for Lua API type definitions and autocompletion.

Because it is already configured as a workspace library in `.vscode/settings.json`, no additional setup is required! Just ensure you have installed the recommended **Lua LS extension** and initialized the submodules during Step 1.

For more details on Umbrella, see the [Umbrella wiki](https://pz-umbrella.github.io/wiki/).

### 3. Configure Environment Variables

Edit `.env` to set your Zomboid game paths. These variables are necessary for automation scripts to handle the modding workflow (e.g., copying your mod to the Workshop directory or starting the game).

```env
# https://pzwiki.net/wiki/Game_files#Cache_folder
ZED_CACHE_DIR=

# https://pzwiki.net/wiki/Game_files#Media_folder
ZED_MEDIA_DIR=
```

### 4. Decompile Game Code (For Reference)

The `zomboid/` directory contains decompiled Java source code for reference only (gitignored for legal reasons).

To decompile from your game distribution:

1. Follow the guide at [pzwiki.net/wiki/Decompiling_game_code](https://pzwiki.net/wiki/Decompiling_game_code)
2. Use [Zomboid Decompiler](https://pzwiki.net/wiki/Zomboid_Decompiler) or [Vineflower](https://github.com/Vineflower/vineflower)
3. Place decompiled sources in `zomboid/` (already gitignored)

## Workshop Item Structure

The community template is a full Workshop item, not a single mod folder. Each workshop item can contain one or more mods inside `Contents/mods/`:

```
MyWorkshopItem/
├── Contents/
│   └── mods/
│       ├── MyMod1/
│       └── MyMod2/
├── preview.png
├── workshop.txt
└── images/               # Optional local-only assets
```

Each mod inside `Contents/mods/` follows the [Build 42 mod structure](https://pzwiki.net/wiki/Mod_structure#Build_42):

```
Contents/
└── mods/
    └── ModName/
        ├── common/           # Shared assets (models, textures)
        ├── 42/               # Build 42 specific
        │   └── media/
        │       ├── lua/      # Lua scripts (client/server/shared)
        │       ├── scripts/  # Item/recipe definitions
        │       └── ...
        └── mod.info          # Mod metadata
```

## Development

### Creating a Workshop Item

You can quickly generate a new workshop item using the official community template:

```bash
./scripts/create_workshop.sh "MyExampleWorkshop" MyExampleMod
```

This creates `MyExampleWorkshop` at the workspace root from `pzmc-template`, renames the initial placeholder mod folder to `MyExampleMod`, and updates `workshop.txt` plus the template `mod.info` files.

### Adding Another Mod to a Workshop Item

You can add more mods to an existing workshop item using the same template mod skeleton:

```bash
./scripts/add_mod.sh "MyExampleWorkshop" MySecondMod
```

This copies `pzmc-template/Contents/mods/YOUR_MOD_HERE` into `MyExampleWorkshop/Contents/mods/MySecondMod` and updates the new mod's `mod.info` files.

### Running Mods in Game

1. **Deploy a Workshop Item**: Use the deploy script to copy a whole workshop item into the local Zomboid Workshop cache. It uses `ZED_CACHE_DIR` from `.env` when set, or falls back to `~/Zomboid`.

   ```bash
   ./scripts/deploy_workshop.sh "MyExampleWorkshop"
   ```

   This deploys the entire directory to `Zomboid/Workshop/<title-from-workshop.txt>/`, including `Contents/mods/`, `workshop.txt`, and `preview.png`.
2. Enable the mod in-game via the Mod menu.
3. Use `-debug` [startup parameter](https://pzwiki.net/wiki/Startup_parameters) for debug mode.

### Debugging Lua

Use the [Lua Debug](https://marketplace.visualstudio.com/items?itemName=actboy168.lua-debug) extension:

1. Set breakpoints in your Lua code
2. Press `F5` to start debugging
3. See [Remote debugging](https://pzwiki.net/wiki/Remote_debugging) for full instructions

### Searching Game Files

To search the game's source files:
1. Open the game `media/` folder as a workspace in VSCode
2. Use `search.useIgnoreFiles: false` to search within ignored files
3. Or use the "Include Ignore Files" toggle in the search panel

## Resources

- [PZ Wiki - Modding](https://pzwiki.net/wiki/Modding)
- [PZ Wiki - Mod Structure](https://pzwiki.net/wiki/Mod_structure)
- [PZ Wiki - Decompiling Game Code](https://pzwiki.net/wiki/Decompiling_game_code)
- [Umbrella Wiki](https://pz-umbrella.github.io/wiki/)
- [Umbrella GitHub](https://github.com/PZ-Umbrella/Umbrella)
- [The Indie Stone Discord](https://discord.gg/theindiestone)

## Notes

- The `Umbrella/` submodule is set to read-only in VSCode settings
- Decompiled sources are gitignored - do not commit them
- Each workshop item may contain multiple mods under `Contents/mods/`
- Refer to [PZ Modding Policy](https://projectzomboid.com/blog/modding-policy/) before publishing
