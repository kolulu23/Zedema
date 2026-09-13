# ZeBadminton

An experimental two-player practice game for **B42.20.x**. ADRs were written before
implementation. Automated verification is available; actual PZ multiplayer testing
is still pending. The projectile is a custom server-simulated shuttle, not a native
bullet/IsoBall. No custom models or animations are shipped.

## Play

1. Install `Contents/mods/ZeBadminton` in the test cache's `mods/` directory on the
   server and both clients, enable `zeBadminton`, and equip `Base.TennisRacket`.
2. Stand at the south end of a clear outdoor area. Right-click the world and choose
   **Badminton: create court north of me**. Green lines mark a 6 × 14 tile court;
   orange is the net line. World north here means decreasing world Y.
3. The other player walks into the opposite half, waits up to five seconds or
   refreshes nearby courts from the context menu, then chooses **join court**.
4. Click **Serve**. Move normally with the keyboard. Click **Clear**, **Smash** or
   **Drop** when the shuttle is in your half and within 2.2 tiles of you, between
   0.25 and 3.1 m high. Smash requires at least 1.8 m. Aim buttons select world-X
   left/centre/right lanes. The marker's black shadow shows where to stand.
5. Each fault awards one point; first to 11 wins. The point winner serves. Leave
   and rejoin to reset; leaving cancels an active rally. Restart removes all courts.

This first slice uses mouse buttons for shots and default character movement.
No badminton swing animation plays yet. Use clear outdoor courts: overlays do not
occlude behind buildings, and shuttle flight does not collide with world obstacles.
Only one local player per client is supported. Nearby observers refresh at 5 s;
participants receive 10 Hz snapshots with up to 150 ms visual extrapolation.

## Design and next steps

- [MVP scope](docs/mvp.md)
- [Projectile ADR](docs/adr/0001-projectile.md)
- [Multiplayer ADR](docs/adr/0002-multiplayer.md)
- [Assets/animation ADR](docs/adr/0003-assets-animation.md)
- [Animation workflow and automation research](docs/animations.md)
- [Prop and clip contract](assets/manifest.json), [Blender scaffold](assets/scaffold_blender.py)
- [Test instructions and real MP acceptance matrix](docs/testing.md)

Run `sh ZeBadminton/tests/run.sh` from the repository root. No generated art,
third-party runtime dependencies, loot changes, engine patches or Workshop upload.
