# ADR 0003: Assets are optional presentation

Accepted for MVP, before implementation, 2026-09-13.

Use the vanilla tennis racket as a temporary racket. No new 3D assets are required
to exercise the protocol. Record model origins, grip and animation contact markers
in assets/manifest.json and docs/animations.md; do not load nonexistent FBX paths.

Character animations use the existing PZ deform skeleton, not a new human rig.
Racket and shuttle are rigid props and need no deform skeleton. Custom actions
will be namespaced and cosmetic, triggered by accepted shot events. The first
prototype reports shot type in the HUD without playing an unrelated combat attack.

Clear/smash/drop share a contact timing contract. Dive requires a separate design
for movement, interruption and recovery before implementation. ImageGen produces
raster art, not usable skeletal motion; no raster generation is needed for this MVP.
