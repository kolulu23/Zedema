# Grapple Hook

A Project Zomboid rope-launcher mod: aim at an upper-floor exterior window,
attach a native escape rope, then climb using the game's normal interaction.
Rope items pay for the hanging rope; the complete material bill is shown before
confirmation. Breaking a closed window is an explicit, potentially noisy action.

## Development status

**Replacement design specified; implementation and game compatibility not yet
validated.** This README describes the intended product, not working controls or
features that have already shipped. This documentation change does not modify the
runtime package.

Start with [the documentation index](docs/README.md), then follow
[the design](docs/design.md) and [the implementation plan](docs/implementation-plan.md).
The [acceptance suite](docs/testing.md) defines what must be demonstrated before
calling the mod playable or multiplayer-safe.

## Scope

The first release targets ordinary exterior windows, one or two floors above a
stationary player, with a clear launch corridor and a usable rope landing. It is
not a swinging, pulling, teleportation, or bullet-damage mechanic. Normal attacks
remain normal attacks; launcher use has a dedicated interaction.

The workspace pin records game 42.20.4 and Umbrella 42.20.0. Those are development
references, not a claim of compatibility with every Build 42 release. See the
[engine contract register](docs/engine-contracts.md).

Workshop item: `GrappleHook`. Mod identity: `grappleHook`. Launcher item identity:
`Base.GrappleHook`. Keeping these public identifiers does not prescribe an
implementation.
