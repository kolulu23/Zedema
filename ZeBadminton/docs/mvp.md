# Badminton MVP — 2026-09-13

Target: workspace pin Umbrella 42.20.0 / locally decompiled Java 42.20.4.
Status: implementation prototype; real two-client acceptance is required before release.

Two consenting players equip Base.TennisRacket, create/join a temporary outdoor,
axis-aligned 6 × 14 tile court and rally a harmless simulated projectile.
Create places the net seven tiles north of the creator; join from the opposite half.
Court lines, net, shuttle and its ground shadow are client overlays. Three shot
profiles (clear, smash, drop), three lateral aim lanes, reach/height checks, alternate
hits, net/out/ground faults and rally-point scoring form the first playable slice.
First to 11 wins (practice rule, no deuce); winning side serves the next rally.
No inventory spawning or consumption. No Workshop publication or game patch.

Included: server authority, fixed-step gravity/drag flight, sequenced snapshots,
participant leases, bounded courts, disconnect/death cleanup, late join discovery,
pure-Lua simulation tests and mocked multiplayer transport tests.
Deferred: doubles, regulation service boxes/deuce, persistent courts/net objects,
loot/crafting, stamina/injuries, lag rewind, custom FBX clips, world occlusion,
controller/split-screen support, dive locomotion, native projectile renderer.
Open outdoor space is a prerequisite: this prototype does not collide with walls,
trees or zombies. A dive must not become a client-authorized teleport.

Acceptance: two actual B42.20.x clients on a dedicated server can complete a rally,
see identical scores, reconnect safely, and cannot hit from outside server reach.
Automated tests supplement this acceptance; they do not replace it.
