# Zedema - Project Zomboid Modding

## What This Is

A Project Zomboid modding workspace for Build 42 workshop items. Currently includes Hold The Door mod — a mod that lets players physically hold doors shut with their body to keep zombies out when barricades aren't available.

## Core Value

Enable players to defend doors with their body when no barricades are available, adding mechanical depth to door defense and rewarding player commitment.

## Requirements

### Validated

- ✓ **Hold The Door v0.1.0** — Implemented mod with context menu, timed action, HP boost, knockdown

### Active

- [ ] Custom bracing animation
- [ ] Window holding support
- [ ] Multi-holder support (multiple players bracing one door)
- [ ] MP networking (sendClientCommand/sendServerCommand for HP sync)
- [ ] Stamina drain while holding

### Out of Scope

- **Barricade replacement** — This augments barricades, doesn't replace them
- **Forced door locking** — Players can still open held doors from inside
- **Window breaking** — Not in scope for v1

## Context

- Build 42 (versionMin 42.17)
- Mod ID: holdTheDoor
- Author: kolulu
- Directory: HoldTheDoor/
- Architecture: client/server/shared Lua split
- Config: Sandbox options (HP multiplier, stumble duration)

## Constraints

- **Build Target**: 42.17+ — Required for certain API features
- **Platform**: Windows (primary), cross-platform file structure
- **No external dependencies**: Pure Lua mod, no additional assets required

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| ISBaseTimedAction for hold mechanics | Leverages existing PZ action system for start/update/stop lifecycle | ✓ Good |
| ModData for door/player state | Persists across chunks, survives save/load | ✓ Good |
| Client-side action, server-side events | Follows PZ convention for client/server split | ✓ Good |
| Proportional HP restore | Fair behavior when door takes damage before breaking | ✓ Good |

---
*Last updated: 2026-04-25 after initialization*