# Making badminton animations

## Recommended workflow

Use Blender with a PZ-compatible human rig. Start with one standing forehand clear,
prove export/playback in the exact target build, then make the rest of the set.
The [Paddlefruit Community Rig](https://github.com/Paddlefruit/ProjectZomboid_CommunityRig)
currently documents Blender 5.1+, IK switching/snapping, asset import and PZ animation
export. Its [wiki](https://github.com/Paddlefruit/ProjectZomboid_CommunityRig/wiki)
is the rig-specific usage reference. This research did not test its export against
42.20.4; perform that compatibility spike before committing to a large library.

1. Load the human rig and a reference model from your own game installation. Preserve
   the deform bone names, hierarchy, rest pose and scale. Animate controls, not a
   newly invented human skeleton. A racket and shuttle are rigid props; neither
   needs skinning. Parent a temporary racket to the hand for preview only.
2. Run `assets/scaffold_blender.py` in Blender's Text Editor if helpful. It creates
   grip/contact/cork/skirt empties plus named empty actions with timing properties.
   It deliberately supplies no mesh, keyframes, bone rig or automatic export.
3. Record front and side video of your own swing. Block ready, anticipation,
   contact, follow-through and recovery poses at 30 fps. Use foot IK to keep plants
   stable; use shoulder/torso rotation and elbow extension, then wrist rotation.
4. Make one in-place action per clip. `assets/manifest.json` gives provisional
   durations/contact frames. These are design targets, not game engine conventions.
   Keep the racket head at the intended contact point on the contact frame.
5. Bake evaluated motion onto the deform bones before export, using the rig's
   exporter first. Blender's [Bake Action documentation](https://docs.blender.org/manual/en/3.1/animation/actions.html)
   explains baking constraints/drivers into keys; the [FBX exporter documentation](https://docs.blender.org/manual/en/5.0/addons/import_export/scene_fbx.html)
   explains action/export limitations. Verify orientation with one clip instead of
   assuming universal axis/export settings. Avoid exporting control bones and
   unrelated actions. Check the exported clip in a clean scene and in the game.
6. Integrate the verified clip through a namespaced player action AnimSet node.
   Inspect the exact installed build's player/actions XML and this workspace's
   HoldTheDoor action example. Do not override a vanilla XML file or add references
   to an FBX that does not exist. PZ directory conventions such as `AnimSets` and
   `anims_X` conflict with this workspace's blanket lowercase rule: resolve the
   engine's actual case-sensitive loader expectations in the integration spike.
   No such runtime folders are created by this MVP.
7. Test male/female bodies, bulky clothing, all facing directions, walking
   transitions, interruption/death and the remote observer view. Check foot sliding,
   wrist grip and racket contact at slow playback before tuning gameplay timing.

## The moves

| Clip | Block the motion | Gameplay integration |
| --- | --- | --- |
| Punch clear | Short backswing, high contact, quick forearm extension, compact recovery | Current clear trajectory; refine timing after clip testing |
| Smash | Torso load, high elbow, overhead contact, downward follow-through | Only accepts shuttle height >= 1.8 m in MVP |
| Drop | Similar preparation to clear, softer wrist/contact, short follow-through | Lower-speed, shallow target profile |
| Serve | Shuttle presentation/release, underhand racket path, recovery | Add a separate cosmetic shuttle-in-hand prop later |
| Dive L/R | Push-off, reach/contact, ground landing, recovery | Deferred: server-validated displacement and cancellation needed |
| Recover | Ground-to-ready with stable supporting limbs | Deferred with dive |

A dive should reserve a short movement window on the server, sweep the destination
for obstacles, enforce recovery/cooldown and cancel on death or interruption.
Do not use client root motion or a client-provided end position as authority.

## What can be automated?

The [AnimForge author's repository](https://github.com/AlexVDefi/AnimForge) describes
live in-game posing, a keyframe timeline and export/baking into .x animations with
AnimSet/Lua hooks. Its documented setup is Windows-oriented and needs an engine
patch. Treat it as a separate authoring experiment, not an MP mod dependency. It
was not installed or executed here.

Rig IK, pose mirroring, baking, batch exports and file/marker validation are good
automation targets. Mocap or video-to-motion can provide a starting pose sequence,
but still needs retargeting and manual foot, wrist, grip and contact cleanup. This
research did not establish a one-click badminton-to-PZ motion generator.

ImageGen can help with later icons, posters and pose references. It cannot produce
usable skeletal clips or FBX rigs, and the MVP needs no generated raster assets.

## Animation/network contract for the next iteration

Current hits are instantaneous server decisions, displayed as a HUD event. No
custom character motion is implemented. Before adding windups, extend the protocol:
client requests a shot; server starts a bounded windup and schedules contact on its
own clock; at contact it revalidates membership, reach and height, then launches or
misses. Send an action id, shooter identity, clip and start/contact timing in the
accepted event. Peers deduplicate action ids and play cosmetically; animation events
must never directly award points or set projectile velocity. A snapshot's repeated
`event` string is not sufficient to trigger a clip once.
