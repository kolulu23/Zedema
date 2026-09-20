# Design review and replacement constraints

Date: 2026-09-20. Scope: product description, architecture rationale, testing
claims, and the repository's API pin. This is a design review, not a runtime bug
trace. The replacement specification is independent of implementation code.

The product worth retaining is small: a handheld tool creates a climbable native
rope at an upper-floor window. The following choices are rejected, rather than
carried into an implementation backlog as patches.

| ID | Rejected design | Why it is unacceptable | Replacement contract |
| --- | --- | --- | --- |
| R01 | Intercepting global combat and replaying attacks to repair interception | Launcher correctness becomes coupled to every weapon, player, and other combat mod | D02: dedicated tool interaction; zero combat interception or replay |
| R02 | Treating a zero-damage weapon as proof of harmlessness | Damage numbers do not establish absence of swings, shove behavior, stamina use, or input conflicts | D02: verified non-combat tool and action presentation |
| R03 | Automatically choosing the nearest valid floor | The selected window may differ from the player's intent without a visible choice | D03: explicit floor and edge selection; no automatic substitution |
| R04 | Addressing a window only by its square | A square can expose different edges; a replacement object can appear at the same address | D03/D05: canonical edge plus short-lived, server-bound object identity |
| R05 | Accepting any visibility result not recognized as blocked | Unknown API values and missing geometry become permission to fire | D04: clear/blocked/unknown classification; only proven clear passes |
| R06 | Equating a visibility check with projectile clearance or rope usability | Overhangs, intermediate floors, wrong-side attachments and inaccessible landings need distinct checks | D04: launch corridor, target face, rope column and landing are separate proofs |
| R07 | Pricing rope by target-minus-player floor count or hiding fastener consumption | Height difference need not equal the native rope footprint or debit | D06: exact server-authored material bill matched to a native footprint |
| R08 | Breaking glass before non-mutating feasibility checks finish | A failed request can cause permanent damage without delivering a rope | D07: preflight before mutation, then explicit partial-failure outcomes |
| R09 | Assuming an engine helper is atomic, authoritative and fully replicated because it exists | A declaration proves none of its inventory, failure or networking semantics | E04/E05: source inspection and real dedicated-server contracts before implementation |
| R10 | Multiple completion paths, repeated network requests, or optimistic client world edits | Effects can be duplicated, reordered, or applied without validated intent | D05/D07: one native action executor, one authoritative writer, one-use quotes |
| R11 | Ignoring cancellation, target replacement, concurrent shots and lifecycle cleanup | Ordinary play creates stale actions, resource loss or interference between players | D05/D08: bounded action state, final revalidation, per-player ownership and cleanup |
| R12 | Calling mocks, static symbol checks or broad version labels compatibility evidence | These cannot demonstrate Kahlua execution, actual climbing or replication | D10 and testing.md: evidence tiers and a real-engine release gate |

## Evidence corrections

The workspace pin identifies game 42.20.4 and Umbrella 42.20.0, not an open-ended
support range. The inspected type declarations are useful evidence of available
names and signatures only. They do not establish runtime success. See the
[engine contract register](engine-contracts.md) for pinned reference links.

A documentation claim dated **2026-09-25** cannot support a review performed on
**2026-09-20**. It is not accepted as an executed test. Conflicting descriptions of
asset readiness likewise do not establish that an item can be safely equipped.
The new evidence register starts runtime checks at **NOT RUN**.

## Deliberate tradeoffs

The replacement prefers an explicit launcher interaction over ordinary attack
binding, conservative exterior geometry over general-purpose ballistics, and a
server quote over instant optimistic deployment. False-negative targeting is
acceptable for unsupported geometry; destructive false positives are not.

Native rope behavior remains the compatibility boundary. The design does not
invent custom climb physics, suppress glass hazards, silently alter resource
bills, or promise rollback of irreversible engine effects. These are scope and
correctness decisions, not unfinished polish tasks.
