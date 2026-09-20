# Grapple Hook documentation

Design baseline: 2026-09-20. Status: **specified, not implemented or runtime-certified**.

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
fixtures. Do not import an existing implementation, copy its tests as an oracle,
or write a file-by-file repair plan. No compatibility shims, attack passthrough,
or parallel deployment mechanisms are part of this design.

`custom-assets.md` specifies the art-production workflow and presentation boundary.
Its script examples are staging templates, not runtime-certified definitions.
Custom held/ground models and readable feedback belong to the release pipeline;
custom skeletal clips, transient hook flight and remote custom effects have separate
scope/evidence requirements. Cosmetic playback never authorizes a deployment.

The [first ADR](adr/0001-grapple-hook.md) is a supersession marker, not additional
implementation guidance. Git history retains previous documentation; there is
only one active design.

This change is documentation only. No game, multiplayer, performance, or runtime
test result is asserted by these documents. Proposed limits and timings are
initial design values, not benchmark measurements.
