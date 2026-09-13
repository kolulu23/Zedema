"""Static checks against the repository's pinned Umbrella references."""
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

repo = Path(__file__).resolve().parents[2]
media = repo / "HoldTheDoor/Contents/mods/HoldTheDoor/42/media"
lua = media / "lua"
sources = list(lua.glob("*/holdthedoor/*.lua"))
assert len(sources) == 5
stubs = "\n".join(p.read_text() for p in (repo / "Umbrella/library").rglob("*.lua"))
api = set(re.findall(r"function\s+[\w.]+:([\w]+)\(", stubs))
own = set()
for p in sources:
    own.update(re.findall(r"function\s+[\w.]+:([\w]+)\(", p.read_text()))
calls = set()
for p in sources:
    text = p.read_text()
    calls.update(re.findall(r":([A-Za-z_]\w*)\(", text))
    assert all(s == s.lower() for s in p.relative_to(lua).parts)
    for required in re.findall(r'require "(holdthedoor/[^\"]+)"', text):
        assert any((lua / area / (required + ".lua")).is_file() for area in ("shared", "client", "server")), required
assert not (calls - api - own), f"Unknown API method names: {calls - api - own}"
for event in set(re.findall(r"Events\.([A-Za-z_]\w*)", "\n".join(p.read_text() for p in sources))):
    assert f"Events.{event} =" in stubs, event
translations = {}
for p in lua.glob("shared/Translate/EN/*.json"):
    english = json.loads(p.read_text())
    chinese = json.loads((p.parent.parent / "CN" / p.name).read_text())
    assert english.keys() == chinese.keys(), f"Translation key mismatch: {p.name}"
    assert all(isinstance(v, str) and v.strip() for v in chinese.values())
    translations.update(english)
for p in sources:
    for key in re.findall(r'getText\("([^"]+)"\)', p.read_text()):
        assert key in translations, key
node = ET.parse(media / "AnimSets/player/actions/holdthedoor.xml").getroot()
assert node.tag == "animNode"
assert node.findtext("m_AnimName") == "Bob_AimShove"
assert node.findtext("m_Conditions/m_StringValue") == "HoldTheDoorBrace"
assert node.find("m_Events") is None
assert node.findtext("m_useDeferredMovement") == "false"
assert node.findtext("m_TrackTimeToVariable") == "HoldTheDoorPose"
assert node.findtext("m_Looped") == "false"
assert float(node.findtext("m_SpeedScale")) == 0
for field in (child.tag for child in node):
    assert f'"{field}"' in (repo / "zombie/core/skinnedmodel/advancedanimation/AnimNode.java").read_text(), field
mod_info = (media.parent / "mod.info").read_text()
assert mod_info.endswith("\n")
metadata = dict(line.split("=", 1) for line in mod_info.splitlines() if line)
assert metadata["id"] == "holdTheDoor"
assert (media.parent / metadata["poster"]).is_file()
assert metadata["description"] == translations["description"]
for lang in ("EN", "CN"):
    info = json.loads((lua / "shared/Translate" / lang / "Mod.json").read_text())
    assert info.keys() == {"name", "description"}
    # Only paragraph breaks: no font/color/alignment state leaking between lines.
    assert set(re.findall(r"<[^>]*>", info["description"])) == {"<BR>"}
print(f"Validated {len(sources)} Lua modules, {len(calls - own)} referenced API method names, events, requires, EN/CN parity, mod metadata and held-pose XML")
