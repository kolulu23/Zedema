"""Static checks for the Grapple Hook mod against the repository's pinned references.

Run from the repository root: python3 GrappleHook/tests/validate.py
"""
import json
import re
import struct
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
item_root = repo / "GrappleHook"
mod_root = item_root / "Contents/mods/GrappleHook"
media = mod_root / "42/media"
lua = media / "lua"

sources = sorted(lua.glob("*/grapplehook/*.lua"))
expected = {"core.lua", "targeting.lua", "attach.lua", "action.lua", "reticle.lua", "client.lua", "authority.lua"}
assert {p.name for p in sources} == expected, sorted(p.name for p in sources)

stubs = "\n".join(p.read_text() for p in (repo / "Umbrella/library").rglob("*.lua"))
api = set(re.findall(r"function\s+[\w.]+:([\w]+)\(", stubs))
own = set()
for path in sources:
    own.update(re.findall(r"function\s+[\w.]+:([\w]+)\(", path.read_text()))

calls, joined = set(), []
for path in sources:
    text = path.read_text()
    joined.append(text)
    calls.update(re.findall(r":([A-Za-z_]\w*)\(", text))
    assert all(part == part.lower() for part in path.relative_to(lua).parts), path
    for required in re.findall(r'require "([^"]+)"', text):
        if required.startswith("grapplehook/"):
            assert any((lua / area / (required + ".lua")).is_file() for area in ("shared", "client", "server")), required
joined = "\n".join(joined)
unknown = calls - api - own
assert not unknown, f"Unknown API method names: {sorted(unknown)}"

events = (repo / "Umbrella/library/events.lua").read_text()
for event in sorted(set(re.findall(r"Events\.([A-Za-z_]\w*)", joined))):
    assert f"Events.{event} =" in events, f"Unknown event: {event}"

hooks = (repo / "zombie/Lua/LuaHookManager.java").read_text()
for hook in sorted(set(re.findall(r"\bHook\.([A-Za-z_]\w*)\.", joined))):
    assert f'AddEvent("{hook}")' in hooks, f"Unknown Lua hook: {hook}"

# Engine globals the mod calls. A rename here is silent at load time and only fails
# when the code path runs, so it is pinned.
globals_stub = (repo / "Umbrella/library/java/__global.lua").read_text()
for name in ("instanceof", "getCell", "getMouseXScaled", "getMouseYScaled", "getCore",
             "getText", "isClient", "isServer", "sendClientCommand", "sendServerCommand"):
    assert f"function {name}(" in globals_stub, f"Unknown engine global: {name}"

en = {path.name: json.loads(path.read_text()) for path in lua.glob("shared/Translate/EN/*.json")}
cn = {path.name: json.loads(path.read_text()) for path in lua.glob("shared/Translate/CN/*.json")}
assert en.keys() == cn.keys(), (sorted(en), sorted(cn))
english = {}
for name, table in en.items():
    assert table.keys() == cn[name].keys(), f"Translation key mismatch in {name}"
    assert all(isinstance(value, str) and value.strip() for value in cn[name].values()), name
    english.update(table)
for key in sorted(set(re.findall(r'getText\("([^"]+)"\)', joined))):
    assert key in english, f"Missing translation: {key}"

items = (media / "scripts/grapplehook/items.txt").read_text()
assert "module Base" in items
assert "ItemType = Weapon" in items, "Build 42 item class key is ItemType"
assert not re.search(r"^\s*Type\s*=", items, re.M), "a bare Type key is not parsed in Build 42"
assert "MinDamage = 0" in items and "MaxDamage = 0" in items, "the hook must be harmless"

info = (mod_root / "42/mod.info").read_text()
for field in ("id=grappleHook", "name=", "versionMin=42.20"):
    assert field in info, field
assert (mod_root / "common").is_dir(), "common/ is required for Build 42 detection"

sandbox = (media / "sandbox-options.txt").read_text()
for option in ("GrappleHook.MaxFloors", "GrappleHook.MaxRange", "GrappleHook.BreakWindows",
               "GrappleHook.NoiseRadius", "GrappleHook.Debug"):
    assert option in sandbox, option
    assert f"Sandbox_{option.replace('.', '_')}" in english, option

icon = (media / "textures/item_GrappleHook.png").read_bytes()
assert icon[:8] == b"\x89PNG\r\n\x1a\n", "icon is not a PNG"
width, height, depth, colour_type = struct.unpack(">IIBB", icon[16:26])
assert depth == 8 and colour_type == 3, f"textures must be 8-bit palette PNGs, got depth {depth} type {colour_type}"
assert (width, height) == (32, 32), (width, height)

for asset in (item_root / "preview.png", mod_root / "42/poster.png"):
    assert asset.is_file(), asset

print(f"grapple hook static checks passed ({len(sources)} lua sources)")
