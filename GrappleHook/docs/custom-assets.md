# Custom launcher models, animation and effects

Status: authoring and integration instructions, 2026-09-20. **No custom asset has
been built or tested by this documentation change.** Read [the design](design.md)
first. This guide implements its presentation boundary; it does not introduce a
second deployment path, projectile simulation or replacement rope system.

Use the branch's game 42.20.4 / Umbrella 42.20.0 references. Source citations below
establish declarations and authoring workflows, not target-build runtime support.
All dimensions, polygon counts and timings in this guide are proposed production
budgets, not engine limits or measured results.

## 1. Deliverables and visual direction

Make the launcher look like a compact, improvised mechanical rope tool: readable
hook head, short launch guide, grip and rope spool. Favor a strong silhouette,
painted metal, a dark grip and a visibly distinct rope color. Do not rely on tiny
engraving or photorealistic scratches to identify it at normal game zoom. There is
no need for a firearm muzzle flash, laser sight, smoke plume or blood effect.

| Asset | First-release deliverable | Initial authoring target |
| --- | --- | --- |
| Held launcher | Custom rigid mesh with UV texture and calibrated hand alignment | 500-1,500 triangles; one material; one 256x256 atlas |
| Ground launcher | Correctly oriented dropped/placed model; share mesh/atlas when possible | Reuse held geometry, or simplify toward 200-800 triangles |
| Inventory icon | Individually cleaned silhouette with transparency | 32x32 shipping candidate, with a 64x64 editable master |
| Aim/landing UI | Edge marker, landing marker, cost/warning labels | Simple shapes plus text; no color-only status |
| Launch feedback | Short custom mechanical sound and a result cue | One short one-shot; no persistent emitter |
| Hook/line accent | Optional transient cosmetic sprite/line | 16x16 or 32x32 hook sprite; at most 16 line segments |
| Character animation | Verified native tool pose first; custom clip optional | Static item follows hand; no custom item skeleton initially |

A static mesh can move with the character's hand without being skinned. Keep the
spool and hook rigid in the baseline model. The live hook-flight accent is a visual
representation, not an inventory item; it is not spawned as loot. After deployment,
the persistent climbable rope is entirely native. Do not leave a permanent custom
hook or duplicate rope overlay on the window without a separate removal/save design.

The artwork may start alongside P0. Shipping integration still depends on engine
contracts E01/E11-E13. An artist can finish a mesh while a runtime contract remains
NOT RUN; those are different completion states.

## 2. Authoring tools, source files and package layout

Use Blender for the mesh/UVs and optional skeletal animation, a raster editor such
as Aseprite or Krita for the atlas/icon, and an audio editor for original sound
layers. Record exact tool/exporter versions; do not require whichever version is
currently called latest. FBX is this pipeline's selected export candidate. GLB or
other formats need a separate exact-build loader probe before substituting them.
Blender documents selected-object export, axis conversion and animation baking;
these exporter options do not themselves establish PZ's coordinate conventions. [B1]

Keep editable work outside `Contents/`. Follow the workspace's common/versioned
asset layout; preserve required engine folder capitalization such as `models_X`
and `anims_X`, while making new basenames and namespace subfolders lowercase. [R1]

```text
GrappleHook/
  art/
    models/gh_launcher.blend
    textures/gh_launcher.aseprite
    textures/gh_launcher_icon.aseprite
    audio/gh_launch_source.wav
    export-profile.md
    asset-manifest.md
    reference/                         local-only game references; do not publish
  Contents/mods/GrappleHook/
    common/media/
      models_X/grapplehook/gh_launcher.fbx
      models_X/grapplehook/gh_launcher_ground.fbx   only if a separate mesh is needed
      textures/grapplehook/gh_launcher.png
      textures/item_gh_launcher.png
      textures/grapplehook/fx/gh_hook.png           optional
      textures/grapplehook/fx/gh_line.png           optional
      sound/grapplehook/gh_launch.ogg
    42/media/
      scripts/grapplehook_models.txt
      scripts/grapplehook_items.txt
      scripts/grapplehook_sounds.txt
      lua/client/grapplehook/presentation.lua
```

The layout is proposed output, not a list of files already present. Do not add
empty placeholder binaries to make the paths exist. Optional character clips go
under the verified `anims_X` path, with their target-build animation definitions
in the proper `AnimSets` structure; derive exact nesting from installed examples.
Version-coupled animation definitions stay with the versioned mod package. [R1]

Keep an asset manifest with logical ID, source path, output path, author/provenance,
redistribution permission, source/export checksums, dimensions/triangle count,
export-profile revision and game-test evidence. Keep proprietary game reference
meshes/rigs out of commits and workshop uploads. Source artwork you own may be
committed; release packaging must not accidentally include `art/` or reference files.

## 3. Build the rigid launcher in Blender

### A. Establish scale and alignment before detail

1. Make a dedicated scene with `export` and `reference` collections. Bring in a
   locally available, similarly held vanilla tool only as a scale/pose reference.
   Record its script/model identity and game version. Do not modify or redistribute
   the reference. A native model viewer can provide comparison when import fails.
2. Block out the grip, body, launch guide, spool and hook from simple meshes. Compare
   the grip with the character's hand, not just a Blender meter ruler. Use an
   asymmetric test shape or marked front/top faces so an axis flip is obvious.
3. Choose and document a local origin near the grip and an explicit forward axis.
   Put authoring markers at `grip`, `support_grip`, `muzzle` and `ground_contact`.
   These are working-scene labels, **not automatically recognized PZ sockets**.
4. Export a crude checker-textured blockout and calibrate it in the actual item
   shell before spending time on details. Prove held and ground rendering separately.
   Do not use a weapon class or combat overrides to make the model appear.

### B. Finish geometry

Work in the editable source, then create a controlled export copy. Use geometry for
the hook curve, grip and spool outline; paint rope windings and small seams. Remove
hidden internal faces, duplicate vertices and zero-area faces. Inspect face normals,
thin parts and the underside from all eight character facings. Slightly thicken a
hook prong when necessary for readability rather than adding subdivisions everywhere.

Triangulate the export copy deliberately, inspect shading after triangulation, and
count triangles rather than quads. Bake the modifiers needed for the final mesh.
Apply intended object rotation/scale to a rigid export copy and check that doing so
did not move the chosen pivot. Do not indiscriminately apply transforms to an
animation rig later; that is a separate workflow. Keep the reference collection,
lights, camera, measurement helpers and unused meshes out of the exported selection.

### C. UVs and texture

Mark seams on less-visible surfaces, unwrap, and inspect a checker grid for stretched
texels. Give the visible hook, body and grip useful atlas space. Blender's unwrap
operators create UV mappings from seams and projections. [B2]

Use one atlas for the first asset. Paint broad material/value differences, restrained
wear and modest cavity shading. Leave padding around UV islands and inspect the
texture at reduced resolution. Do not make the model depend on Blender procedural
nodes, embedded images, normal maps, roughness maps or emission until the selected
PZ shader has been proved to use them. The shipping baseline uses a simple painted
color texture and verified shader defaults.

Export model texture and icon as 8-bit-per-channel RGB/RGBA PNGs, as appropriate,
consistent with the workspace asset requirement. Use transparency for icons/effect
sprites; do not add translucent surfaces to the launcher unless their rendering
has been tested. An 8-bit-per-channel RGBA image is not the same thing as an
8-bit indexed/palette image. Check alpha edges against dark and light backgrounds. [R1]

For the icon, render or paint a three-quarter silhouette, then clean it at the
shipping pixel size. Enlarge the hook/spool distinction if downsampling loses it.
A transparent 32x32 icon is an initial target, not proof of a required engine size.
Test the inventory UI at supported UI scales and retain a larger editable master.

## 4. Export, register and calibrate the model

### Export profile

Export selected rigid meshes to binary FBX. Disable animation export for the static
asset; do not export an armature, cameras or lights. Record the actual settings for
unit scale, export scale, forward/up axes, transform application, modifiers, normals,
selected object types and texture embedding. Supply PNGs separately. Blender's FBX
options and material conversion have their own limitations; copying an export
preset from another engine is not a PZ compatibility test. [B1]

There is deliberately no universal `scale=0.01` or fixed axis prescription here.
Start from the locally verified reference, export the asymmetric calibration mesh,
and change one transform stage at a time. Save a working export preset plus measured
hand/ground offsets before producing the final mesh. Do not compensate for a wrong
FBX scale with unrelated hand, ground and screen offsets.

### Registration template

The following is a **staging template**, not a tested 42.20.4 script. It shows the
three separate names: model-script ID, mesh resource and texture resource. Check
key spelling, static-model selection, module lookup and extension handling against
installed vanilla model scripts and E11 before putting it in the runtime package.
The source references expose model/attachment concepts, not this parser grammar. [U6][U7]

```text
module GHAssets
{
    model gh_launcher
    {
        mesh = grapplehook/gh_launcher,
        texture = grapplehook/gh_launcher,
        scale = 1.0,
    }

    model gh_launcher_ground
    {
        mesh = grapplehook/gh_launcher,
        texture = grapplehook/gh_launcher,
        scale = 1.0,
    }
}
```

`1.0` is a calibration starting point, not a known correct game scale. The two
model definitions initially share a mesh; ground placement needs its own proven
orientation/attachment setup, or a separate ground export when necessary. Copy only
the registration structure from a verified vanilla example, not unrelated item
behavior. Use a separate namespaced script filename; never replace a vanilla file.

These are **candidate presentation fields to verify** in the new non-combat item
shell, not a complete item declaration:

```text
Icon = gh_launcher,
StaticModel = GHAssets.gh_launcher,
WorldStaticModel = GHAssets.gh_launcher_ground,
```

Under the workspace convention, `Icon = gh_launcher` resolves the intended
`media/textures/item_gh_launcher.png`. Model resources are intended to resolve
under `models_X` and textures under `textures`. Verify the resolver's actual case,
extension and module rules in the installed build. A recognized `WorldStaticModel`
concept does not prove how a non-combat item is displayed in the hand. E01 must
prove that path; do not change the item to `Weapon` as a workaround. [R1][J1]

### Hand, muzzle and ground calibration

The pinned `ModelScript` exposes attachment lookup, and `ModelAttachment` exposes
bone, offset and rotation data. They do **not** prove that exporting a Blender Empty
creates an attachment or that a local offset is already a world position. [U6][U7]

Use the exact-build attachment/model editor when available, or adjust the model
script using the installed example's grammar. Resolve the actual attachment IDs
consumed by the item/hand renderer; names such as `grip` in the Blender scene are
not a substitute. Record position, rotation, units and order of transforms. Verify:

| Calibration | Test |
| --- | --- |
| Primary grip | Hand encloses the grip without the tool drifting during idle/action |
| Support grip | Optional two-hand pose has no detached hand; not a gameplay requirement |
| Muzzle marker | Visual launch origin stays at the guide tip in all facings |
| Ground transform | Drop/place/rotate/pick up on supported surfaces; no floating or buried item |
| Body variation | Supported player body variants and bulky clothing do not cause severe clipping |

For a world-space muzzle point, a presentation adapter must compose the verified
character/hand, held-model and attachment transforms. Verify this against moving
poses. Do not invent a `getMuzzlePosition()` engine API or use a model-space offset
as world coordinates. Without a verified world transform, the baseline can use a
UI result marker; exact muzzle-origin flight remains disabled. Gameplay launch
geometry remains the calibrated authority rule in D04, never a visual bone query.

## 5. Character animation and moving model parts

### Baseline: rigid custom item, native tool pose

Use a verified timed-action pose with the custom hand model. The pinned
`ISBaseTimedAction` declares animation and hand-model override methods, but E03/E12
must establish when they execute and how normal presentation is restored. Record
the tested animation identifier; do not guess a firearm or melee animation name. [U3]

Aim/brace while winding up; cancel restores the original pose and hand display.
Any visual latch movement or recoil is cosmetic. Do not add a second action,
weapon swing, custom attack event or animation-end inventory mutation. A shortened,
missing or interrupted clip cannot accelerate, duplicate or cancel an already
committed deployment. Do not freeze a character globally while waiting for a reply.

### Optional custom character clip

Only after the native pose works, use the locally obtained target-build character
rig to author a short brace/release/recover clip. Preserve required bone names,
hierarchy, bind pose and root orientation. Author in place: no root translation,
teleportation or locomotion ownership. Prefer one compatible action clip before
attempting an upper-body overlay/blend system.

Keep IK/constraints in the source scene, then bake the intended motion to the
exported skeleton. Export only the selected skeleton and intended action; exclude
unrelated NLA strips/actions. Record sampling and exporter bone settings. Blender
notes that constraints are exported as baked animation rather than live constraints,
and that action associations/bone orientation need care. [B1]

Register a uniquely named clip and action definition using exact-build examples.
Do not overwrite a generic vanilla idle/attack AnimSet file. Verify transitions,
interruptions and restoration on each supported body variant in SP and MP. Exact
XML names and skeleton mappings belong in E12 evidence, not a guessed template.

An animated spool or articulated hook needs either a proved model-animation path
or an explicitly controlled cosmetic mesh swap. Neither is required for the first
release. A custom character clip and a skinned item are different deliverables; do
not rig the entire item just because the character uses animation.

## 6. Visual effects: authoring and timing

### Effect kit

Create a small transparent hook sprite with a clear tip, a neutral line texture,
and an understated endpoint/result marker. A tiny mechanical release accent is
optional. No glowing impact, broken-glass particles or persistent rope replacement
is needed: the native window and rope already own the lasting result.

Start with a HUD marker/line, not an unverified world-space model renderer. The
pinned `ISUIElement` declares `drawLine`, `drawLine2` and `drawPolygon`, and `IsoUtils`
has projection helpers. These enable a candidate UI implementation, not proof of
depth-tested 3D rendering or a supported native projectile API. [U5][U8]

### Timing contract

| Phase | Allowed presentation | Forbidden behavior |
| --- | --- | --- |
| Aiming/quoted | Reticle, landing/cost labels, non-world UI selection feedback | Projectile launch, glass impact or zombie-attracting launch noise |
| Wind-up | Brace pose; optional local handling cue | Spending, rope creation, success indication or a launch cue before authority commits |
| Fresh successful outcome | Short result cue and optionally a hook/line accent | Delaying native commitment until a visual reaches the window |
| Rejected/cancelled | Reason text; stop owned presentation | Success/impact animation, refund or retry initiated by effects |
| Partial/unknown | Explicit warning and observed-state UI | A convincing successful attachment effect |

The existing design commits native world changes without waiting for a projectile
flight. Therefore an optional 100-150 ms hook/line accent is **post-confirmation
feedback**, not a physically timed projectile. The rope may already be visible.
Prefer an immediate endpoint cue when that accent looks misleading. Do not hide
native ropes, delay replication, or split the commit to synchronize an animation.
True pre-impact flight would change the execution/failure model and requires a
separate design revision.

Consume the existing correlated, fresh outcome on the owning client; bind local
presentation to the submitted quote and captured world endpoints. No new client
fire/effect request authorizes anything. Cache only primitive visual state, not
long-lived window references. Status-query replies, reconnect state and duplicate
outcomes update text but do not replay the launch accent or sound. The baseline is
owner-local VFX; nearby observers see native rope/window changes. Remote custom VFX
would require a separate, bounded server-to-observer presentation contract, with
interest filtering and no private material bill. It is not implied by this guide.

### Rendering and cleanup

Advance an effect on a chosen monotonic presentation clock, not by adding a fixed
amount per frame. For a simple accent use `u=clamp((now-start)/duration,0,1)` and
interpolate from the recorded origin to the recorded anchor. A tiny visual curve is
permitted, but must not be reused as a collision or targeting trajectory.

Project world points through the current local player's camera each frame. Do not
cache screen coordinates while the camera moves. Clip to that viewport and reject
invalid/unloaded endpoints. A HUD line is an overlay: it does not automatically
respect roofs, walls, fog of war or the world depth buffer. Never reveal hidden
windows through it. Use the target's validated visibility/selection state and a
conservative visibility gate; when occlusion cannot be established, omit the
world-like accent and retain an ordinary non-spatial result message.

Preload/cache texture handles outside rendering. Use one client presentation owner
with idempotent registration, not one global callback per particle. Proposed caps:
16 segments per accent, 8 active accents per viewport, 0.5-second hard visual TTL,
and 128 recently handled operation/quote IDs per session. Because only the current
pending local operation may start an accent, evicting a dedup entry cannot authorize
replay. No catch-up queue for obsolete shots. Drop optional effects under load.

Stop owned visuals and looping handles on cancel, equipment change, death, world
change and disconnect; expired one-shots simply finish. Do not call a global
`stopAll` on a shared character emitter. UI closure can remove visuals without
undoing or preventing the authority's result. Lowering or disabling effect detail
must have zero effect on cost, permissions, hit eligibility or success.

## 7. Make and integrate the launch sound

Build a restrained mechanical cue from recordings you own or have permission to
redistribute: latch click, short spring/cable movement and a soft spool tail. Keep
the parts in an editable source session or separate stems. Trim leading silence,
add short fades to avoid clicks, and compare loudness with an ordinary game tool.
A 0.15-0.4 second mono clip at a recorded standard sample rate is a starting asset
target, not a requirement of the engine. Do not bake glass breaking into this clip.

Export a clean source WAV and a shipping OGG or WAV; use file-based custom sounds
rather than assuming custom FMOD banks are loadable. The workspace documents the
supported sound-file route. [R1] The following is a conventional **staging template**
from the file-based sound pattern, not an executed build-specific configuration:

```text
sound GH_Launch
{
    category = Item,
    maxInstancesPerEmitter = 1,
    clip
    {
        file = media/sound/grapplehook/gh_launch.ogg,
    }
}
```

A mod author's file-based example and the engine's `GameSoundClip` file/volume/
distance fields support this integration direction. They do not establish that a
custom file inherits a vanilla FMOD event's reverb, occlusion or replication. Check
script loader placement and key spelling in E13 before shipping. [S1][J2]

**Audible playback and zombie-attracting world noise are separate responsibilities.**
For the baseline, custom audio is local presentation on the owning client after a
fresh successful outcome. Use the adapter's verified non-rebroadcasting playback
path and deduplicate by the same quote/operation as the VFX. Record the playback
handle. The pinned emitter has play/position/individual-stop methods, but E13 must
verify which path stays local and how its lifetime is managed. Do not assume the
ordinary `playSound` overload is local-only. [U9]

The authority emits the launch world-noise stimulus once at the committed attempt's
launch point, subject to D01's NoiseRadius. Native glass breaking owns its sound,
alarm and hazards. Client playback must neither emit a second world stimulus nor
rebroadcast the cue. A zero launch-noise radius does not disable native glass/alarm
behavior, and the player's audio volume does not control server gameplay noise.
Test quiet launch, noisy launch and closed-window break independently.

Custom spatial audio for nearby observers is optional future presentation work,
not an excuse to send another deploy request. Before enabling it, choose and verify
one delivery owner: native sound replication or a filtered server effect event,
never both. Include distance/indoor/occlusion tests and skip expired sounds. The
baseline does not promise everyone hears the custom clip.

## 8. Production sequence and acceptance

| Work package | Concrete output | Gate |
| --- | --- | --- |
| A0: calibration | Asymmetric mesh, checker texture, trial icon and short sound; saved export profile | E01/E11-E13 probe evidence; no release-art claim |
| A1: static item | Custom held/ground registration, painted atlas and cleaned icon | T31-T33; reviewed at actual game size |
| A2: action presentation | Native pose with custom model and interruption cleanup | E12, T38; optional custom clip tested separately |
| A3: local feedback | Fresh-outcome audio/result cue, optional bounded hook/line accent | E13, T34-T36; no gameplay dependence |
| A4: delivery | Source/export manifest, permissions, package audit and comparison captures | T37 and T30; no proprietary references in release |

A0 probes join P0, A1/A2 join P2, and A3 runtime integration waits for P5 before P6.
Artwork, icon cleanup and sound editing can proceed earlier without wiring effects
into a shot. Tests [T31-T38](testing.md) are additional acceptance gates. Optional
custom animation or hook-flight can stay disabled, but must not be advertised as
working; basic item presentation and readable outcome feedback remain required.

Capture the item equipped in all eight facings, dropped/placed, and in inventory;
also record an interrupted action and one successful SP/MP deployment. Include
asset/export hashes and the exact build. A Blender beauty render is useful review
material but does not demonstrate attachment, gameplay timing or replication.

## 9. Troubleshooting order

| Symptom | Investigate first |
| --- | --- |
| Icon works, held model missing | Non-combat held-model path, model-script lookup and export selection; do not convert it into a weapon |
| Model white/black or texture absent | Texture path/case, UVs, image export and shader assumptions; not the inventory icon field |
| Item huge, tiny or rotated | Recorded FBX units/axes, mesh origin and model scale; fix one transform stage at a time |
| Grip works but ground item floats | Ground model/attachment transform and placement context, independently of the hand transform |
| Hook accent starts inside the body | World/local transform composition or wrong hand/model; disable exact-muzzle VFX until calibrated |
| Custom pose sticks after cancellation | Per-action restoration and ownership of overrides; do not globally reset another action's state |
| Rope or sound appears twice | Multiple gameplay/presentation owners, duplicated outcomes or native plus custom playback; never spend twice to compensate |
| Line visible through a roof | Overlay lacks world occlusion; omit the accent rather than claim depth-tested rendering |
| Client works, Linux/server fails | Required folder case, missing assets, duplicate IDs and client API calls in headless contexts |

## References and evidence limits

Sources inspected on 2026-09-20. U references are locked to the workspace's Umbrella
commit. J references are supplementary unversioned official declarations. B references
are versioned Blender authoring documentation. S1 is a mod author's own older sound
example, used only for the illustrative pattern, not Build 42 compatibility.

[R1]: ../../AGENTS.md
[B1]: https://docs.blender.org/manual/en/5.0/addons/import_export/scene_fbx.html
[B2]: https://docs.blender.org/manual/en/5.0/modeling/meshes/editing/uv.html
[U3]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/lua/shared/TimedActions/ISBaseTimedAction.lua
[U5]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/java/zombie/iso/IsoUtils.lua
[U6]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/java/zombie/scripting/objects/ModelScript.lua
[U7]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/java/zombie/scripting/objects/ModelAttachment.lua
[U8]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/lua/client/ISUI/ISUIElement.lua
[U9]: https://github.com/PZ-Umbrella/Umbrella/blob/98f50ae698aab1dc7c44ba4fba87c33c800fee20/library/java/zombie/audio/BaseSoundEmitter.lua
[J1]: https://projectzomboid.com/modding/zombie/scripting/objects/Item.html
[J2]: https://projectzomboid.com/modding/zombie/audio/GameSoundClip.html
[S1]: https://theindiestone.com/forums/topic/60743-custom-sounds-audio-issue/
