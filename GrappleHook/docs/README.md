# Grapple Hook documentation

Design baseline: 2026-09-20. Status: **design-only; no runtime implementation or
executable test suite is present**.

| Document | Purpose |
| --- | --- |
| [Design review](review.md) | Rejected design choices and the constraints replacing them |
| [Product and technical design](design.md) | Normative behavior, architecture, authority, geometry, failure semantics |
| [Implementation plan](implementation-plan.md) | Fresh work packages, dependencies, artifacts, and exit gates |
| [Custom models and effects](custom-assets.md) | Blender modeling/UV/export, hand and ground calibration, icons, animation, audio and cosmetic feedback |
| [Engine contracts](engine-contracts.md) | Verified declarations versus engine behavior still requiring evidence |
| [Acceptance tests](testing.md) | Independent behavioral tests and release evidence |

## Reading and implementation rules

`design.md` is the behavioral authority. `engine-contracts.md` controls what may
be assumed about Project Zomboid. `implementation-plan.md` orders the work;
`testing.md` decides whether that work is done. A plan or a mock cannot override
an unresolved engine contract.

Implement from these requirements, verified engine references, and new behavioral
fixtures. Do not import a historical implementation, copy its tests as an oracle,
or write a file-by-file repair plan. No compatibility shims, attack passthrough,
or parallel deployment mechanisms are part of this design.

The superseded runtime, its tests and the superseded ADR are absent from this
working tree. There is no retained legacy package or executable test runner.
Historical material remains in Git history only. The current design review records
rejected approaches; it does not provide an alternative implementation design.

## Core testing before custom artwork

P0 engine probes and the fresh P2 item shell may use verified vanilla presentation
resources while preserving `Base.GrappleHook` as the item identity and a non-combat
item class. Item registration/equipment and the real gameplay path still need to
be tested; borrowing a model does not bypass those checks.

Custom-asset production and its asset-specific release gates are not prerequisites
for starting core-logic integration tests. Keep custom sound, hook flight and custom
animation disabled until their own contracts are verified. Record core-engine and
custom-asset results separately; a placeholder model pass is not a custom-model
pass. No placeholder item is supplied by this cleanup.

`custom-assets.md` specifies the art-production workflow and presentation boundary.
Its script examples are staging templates, not runtime-certified definitions.
Custom held/ground models and readable feedback belong to the release pipeline;
custom skeletal clips, transient hook flight and remote custom effects have separate
scope/evidence requirements. Cosmetic playback never authorizes a deployment.

## Repository and verification status

The package layouts, artwork paths and implementation modules in these documents
are proposed output. They must be created from the active plan before deploying.
Removing repository files does not uninstall a previously deployed game copy;
see [the mod README](../README.md) before testing a replacement.

No game, multiplayer, performance, or runtime test result is asserted by this
cleanup. Proposed limits and timings are initial design values, not benchmark
measurements. Acceptance scenarios remain requirements until execution evidence
is recorded.
