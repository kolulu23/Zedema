# Grapple Hook

A planned Project Zomboid rope-launcher mod: select an upper-floor exterior window,
confirm its material bill and glass warning, deploy a native escape rope, and climb
using the game's normal interaction.

## Current state

**Design-only workspace. No runnable GrappleHook implementation is included.**

The superseded runtime package, item definition, sandbox configuration, translations,
placeholder images, workshop metadata and implementation-specific test suite have
been removed. The superseded ADR has also been removed rather than retained as a
second source of guidance. Previous revisions remain in Git history, not in an
archive or compatibility layer in the working tree.

Start with [the documentation index](docs/README.md), then follow
[the design](docs/design.md), [the implementation plan](docs/implementation-plan.md),
and [the engine contracts](docs/engine-contracts.md). The
[acceptance specification](docs/testing.md) describes tests to implement; it is not
an executable test suite and does not claim any passing game tests.

The workshop name `GrappleHook`, mod ID `grappleHook` and item ID `Base.GrappleHook`
are reserved for the new implementation. This checkout does not register the item,
provide an equip/spawn helper, or contain an installable mod. Runtime paths shown
in the guides are proposed future output, not files that exist today.

## Starting the implementation

Begin with the P0 engine probes and build a fresh minimal non-combat item shell
for P2. Core integration tests may use verified vanilla icon, held-model and
ground-model references while retaining the real grapple item identity. Custom
models, sound and effects are not prerequisites for starting core-logic tests.
Do not revive the removed runtime to obtain a placeholder item.

Keep the same targeting, validation and authority path intended for release.
Gameplay must not depend on a custom muzzle attachment, animation event or visual
effect finishing. Add custom presentation later using
[the asset guide](docs/custom-assets.md), with its separate verification gates.

The workspace pin records game 42.20.4 and Umbrella 42.20.0. These are development
references, not a claim of compatibility with all Build 42 releases. No game or
multiplayer test has been run as part of this cleanup.

## Previously deployed copies

This commit removes tracked repository files only. It does not uninstall copies
already deployed to a local game cache, Workshop directory or server.

Before testing a fresh package, stop the game/test server, disable the previous
`grappleHook` mod, and remove or isolate only its known deployment directory. Do
not delete a whole game cache, Workshop library, or save directory. Use a disposable
save: compatibility of saved custom items with the new implementation is not yet
established.

Do not deploy or publish this design-only directory. Recreate the package and
metadata from the active plan when the new item shell is ready, then verify that
only that implementation is loaded.
