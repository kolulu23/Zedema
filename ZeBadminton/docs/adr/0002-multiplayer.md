# ADR 0002: Server owns rallies and hit acceptance

Accepted for MVP, before implementation, 2026-09-13.

Client sends only command intent, session id, sequence, shot name and aim lane.
Sender comes from OnClientCommand, never a supplied player id. Server reads live
position, alive status and equipped racket, checks court membership, own half,
reach, shuttle height, turn and cooldown. No client position/velocity/score accepted.
Commands have a version, monotonic sequence and per-sender rate bound. Snapshots
have monotonically increasing revisions; clients discard older ones and extrapolate
at most 150 ms. Full nearby discovery snapshots reconcile removed courts.

Up to eight temporary courts; one membership per player; only participants get
10 Hz live state. Five-second discovery supplies nearby courts; two-second pulses
renew 12-second leases. Death, absence, leaving the court or lease expiry removes
membership; empty courts disappear. Restart resets all practice sessions.

No rewind in MVP: increased latency makes timing less forgiving. Do not increase
reach based on a client-reported timestamp. Future rewind needs bounded history
and dedicated-server measurements. Rendering/animation cannot score points.
