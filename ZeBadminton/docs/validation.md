# Validation record — 2026-09-14

Command: `sh ZeBadminton/tests/run.sh`

Result: **46 checks passed**, plus syntax checks for all three runtime Lua files.
Runtime used: Lua 5.5.1 on macOS, with the existing nanobrew dylib path supplied by
the runner. Game code uses Lua 5.1-compatible constructs, but has not been run in
PZ's Kahlua VM.

Coverage: trajectory integration, reachable return, all shot profiles, net/ground/out
scoring, score idempotence, win condition, wrong-floor/range/turn/equipment rejection,
NaN/invalid command checks, actual-sender membership, command replay, two-sender
server adapter, late discovery, leave/rejoin/death/lease cleanup, client snapshot
revision ordering, duplicate snapshots, vanished-court reconciliation and delayed
leave protection.

Additional checks passed: Blender scaffold Python syntax (AST parsing only), asset
manifest JSON parsing, matching runtime require paths and required `common/` directory.

Not run: Blender execution/export; game loading; actual two-client or dedicated-server
sessions; network impairment; rendering at different zoom levels; Linux runtime;
long-duration load testing. See testing.md for the acceptance matrix.
