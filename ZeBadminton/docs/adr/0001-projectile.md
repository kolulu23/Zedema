# ADR 0001: A harmless Lua projectile, with a replaceable renderer

Accepted for MVP, before implementation, 2026-09-13.

Evidence: zombie/iso/objects/IsoBall.java in pinned 42.20.4 adds random XY velocity,
uses weapon textures, removes itself on contact and emits radius-600 world sound.
The combat path in zombie/CombatManager.java and core/physics/BallisticsController.java
is coupled to weapon targeting. No suitable general-purpose mutable shuttle API
was found in the pinned Umbrella stubs. This is a scoped investigation, not a claim
that native integration is impossible.

Decision: own a numerical projectile (x/y in tiles, height in metres, velocity,
gravity and drag) on the server. Use swept net/ground tests and a fixed 1/60 s step.
The shuttle is genuinely simulated flight, but is NOT an engine IsoBall/bullet.
Render a world-space marker and shadow; replace this adapter with a model later.
Never call attack, damage, explosion or inventory-drop APIs for shuttle contact.

Tradeoff: deterministic tests and reliable harmless behavior at the cost of no
engine world collision/occlusion. Restrict play to clear outdoor courts. A later
native adapter must prove nondamage, MP ownership and lifetime semantics first.
