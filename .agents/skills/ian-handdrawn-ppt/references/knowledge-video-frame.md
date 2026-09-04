# Ian knowledge-video layered-scene adapter

The selected `illustrated-flipbook` branch uses `knowledge-video-static-spread.md` instead. This layered contract remains mandatory for all other knowledge-video styles.

Use `ian-knowledge-video-layered-scene-v2` only when an approved knowledge-video
shot selects `visual_generation_route: ian-handdrawn-ppt`. This mode overrides
the ordinary article/PPT page shell; it does not create a deck or one flattened
production raster.

`ian-knowledge-video-frame-v1`, `ian-static-full-frame-v1`, and
`ian-subtle-raster-motion-v1`, plus
`ian-knowledge-video-layered-scene-v1` independent-member packages are
completed-history contracts only. Do not use them to create, revise, preview,
or render an unfinished or new episode.

## Bound input

Before generation, require one resolved episode workspace, one queue item and
shot ID, the exact shot narration text and frame range, one approved
`ian-layered-scene-plan-v1`, and the current
`per-shot-visual-direction-review-v3` artifact path, file SHA-256, and
`presented_map_sha256`. The selected row must match the shot, route,
`treatment_profile_id`, `visible_text_mode`, exact Chinese, and placement
byte-for-byte. Missing, stale, ambiguous, or mismatched evidence blocks
generation.

The plan divides the complete narration source text into ordered, contiguous,
non-overlapping UTF-8 byte ranges. Each range owns one semantic layer and one
local `entry_frame`. Its count must equal the approved visual-rhythm shot's
`asset_plan.layer_count` and ordered `meaningful_change_events` count. Each
layer's `semantic_role` equals its event description, and `entry_frame` equals
`event.at_frame - shot_start_frame`; never infer these values during generation.
The first layer enters at frame 0; later entries must leave enough room for the
fixed eight-frame fade and must complete before the shot ends. The ranges must
cover the source text exactly once.

## Production object

Create one package with these checksum-bound members and lineage:

- one `gpt-image-2` text-free complete source master in near-16:9 landscape;
- one deterministically normalized 1920×1080 opaque master;
- one deterministic 1920×1080 opaque near-white paper background;
- one ordered 1920×1080 transparent pre-text layer per approved semantic range;
- one corresponding ordered final layer per approved semantic range, identical
  to its pre-text layer unless exact approved text is overlaid on that owner;
- one opaque 1920×1080 final-composite PNG produced deterministically by
  compositing the ordered layers over the background.

The final composite is review evidence, not the Remotion production source.
Remotion consumes the approved background and ordered layers directly.

Generate exactly one complete master rather than independent background/layer
images. Before generation, assign every approved semantic layer one ordered,
non-overlapping composition zone. Require visible gutters of at least the
package's `minimum_inter_layer_gutter_px`, ample negative space, no decorative
content outside the union of those zones, and no visible text. A zone may contain
one coherent semantic group, but it must not contain content owned by another
narration range.

After generation, normalize only by the checksum-bound deterministic
scale-to-cover and centered-crop record. Separate the normalized master offline
with `ian-semantic-region-alpha-split-v1`: use the exact approved bboxes, matte,
alpha thresholds, blur, paper color, gutter, and outside-union limit to rebuild
the static background and full-canvas transparent pre-text layers. The split is
deterministic asset preparation, not a Remotion mask or reveal. Reject overlap,
insufficient gutter, visible content outside the approved union, empty layers,
or nondeterministic reruns; never repair such a master by hand, inpainting,
chroma-key guessing, runtime crop, or transform.

The background and all layers keep identical 1920×1080 registration. Legacy
unchanged evidence retains `ian-layer-entry-fade-v1`. New or revised assembly
uses a checksum-bound `ian-layered-entry-effects-v2` artifact without changing
any package raster byte. Each semantic layer receives exactly one primary
entry effect: `soft-settle-v1` (eight-frame linear fade plus deterministic
damped translation, maximum 10 px, no scale or rotation),
`ink-draw-reveal-v1` (12-frame contour drawing or path growth from approved
SVG path data), or `fade-only-v1` with a non-empty fail-safe reason. When a
layer has less than 12 px canvas-edge margin, it must use fade-only. Runtime
edge tracing, random motion, whole-scene movement, parallax, internal cuts,
and inferred timing are forbidden. The approved incoming
`scene-transition-v3` remains the sole owner of ordinary shot entry.

Contour drawing and path growth share one visual language family. One shot
may use at most two entry language families, and the same semantic element
class must keep the same motion and SFX profile across the episode. Exact
visible text remains part of its owning layer and enters with that layer; it
is never separately animated or rewritten. Every layer also receives one
checksum-bound pre-trimmed stereo 44.1 kHz WAV cue at its exact `entry_frame`:
paper/card uses paper slide at gain 0.19, node/mechanism uses soft click at
0.44, contour/path uses writing pencil at 0.15, and broad-region reveal uses
short sweep at 0.23. Narration remains at gain 1, mix normalization is
forbidden, and any peak above -1 dBFS lowers the SFX bus uniformly rather than
the narration.

## Prompt override

- Reuse Ian's near-white paper, fine handdrawn lines, restrained pastel palette,
  diagram grammar, and negative space.
- Generate the complete master with canonical model `gpt-image-2`. The built-in
  Codex ImageGen interface does not expose a caller-settable model parameter, so
  do not claim that the call explicitly selected a model. Accept only direct
  `codex-native-imagegen` raw output whose SHA-256 is bound to an embedded C2PA
  `softwareAgent` observation of exact name/version `gpt-image/2.0`. This is an
  embedded-claim observation, not cryptographic signature verification. Missing
  direct lineage, checksum equality, or exact observation fails closed.
- Disable the ordinary page shell: no automatic page number, title, subtitle,
  label, signature, watermark, corner text, or filler writing.
- Always use an empty `Required text only` list for the generated master. Both
  `visible_text_mode: none` and `required` masters are completely text-free.
- For `visible_text_mode: required`, deterministically overlay only the exact
  whole-batch-approved Chinese on its owning transparent pre-text layer, using
  the approved placement after the split. The v2 manifest's checksum-bound
  `ian-deterministic-layer-text-overlay-v1` record itself binds the font, exact
  labels, owning layer, container geometry, and final layer; the package
  inspector must replay it. Never write only on the flattened final composite.
  Rebuild the final composite from the changed owning layer, then bind independent
  glyph/container measurements with `ian-layer-text-container-qa-spec-v2`.
  Every glyph must remain at least 8 px inside its intended container. A
  `visible_text_mode: none` package must have overlay mode `none`, zero labels,
  identical pre-text/final layer bytes, and no containment evidence.
- A contact sheet is an outer Visual Asset Review artifact only. Never bake its
  filename, numbering, border, or annotations into any package member.

## Output and validation

Write one `ian-knowledge-video-layered-scene-v2` manifest beside the versioned
review evidence. Its repository-root-relative paths bind the current
storyboard, visual-direction row, narration timing, exact plan, background,
raw and normalized masters, model observation, deterministic split parameters,
ordered pre-text/final layers, text-overlay evidence, final composite, and every
checksum. Package raster members and the generation prompt must remain inside
the resolved episode workspace. The single style anchor is exactly
`.agents/skills/ian-handdrawn-ppt/assets/reference-handdrawn-article-illustration-style.png`;
bind its current on-disk SHA-256 and require a full decode as a 1920×1080
8-bit RGB/RGBA PNG. Any other path, stale checksum, non-PNG bytes, palette image,
or undecodable raster fails closed. The text font may be a checksum-bound
absolute external path.

Run:

```bash
node .agents/skills/ian-handdrawn-ppt/scripts/validate_knowledge_video_layered_scene.mjs \
  <episode-workspace> \
  <ian-knowledge-video-layered-scene-v2.json>
```

The validator rereads every member; checks direct ImageGen lineage plus the exact
`gpt-image/2.0` embedded observation; replays normalization, semantic-region
alpha split, and text overlay; verifies dimensions, alpha roles, bboxes and
gutters; then rebuilds the final composite from the background and ordered final
layers and requires exact byte equality. Structured QA and Visual Asset Review
remain required; the manifest cannot approve its own pixels.

QA records exactly one `ian-gpt-image-2-text-free-master-v1` generation stage.
It binds the prompt, pinned Ian style reference, direct raw output path/checksum,
text-free visual QA, and model-provenance observation. Background, pre-text
layers, final layers, and final composite are deterministic derivatives and have
no independent ImageGen stages. Independent member generation is forbidden for
new or unfinished packages.

`ian-layer-text-repair-v1` and `ian-layer-text-container-qa-spec-v1` remain
read-only evidence for completed v1 packages; never emit them for v2.

## Migration

Completed historical episodes remain byte-for-byte read-only. For every
unfinished episode, invalidate each active Ian single-raster or v1
independent-member asset plus its downstream visual approval, visual manifest,
assembly plan, preview, render,
and delivery evidence. Preserve narration, audio, and non-Ian assets when their
bindings remain current. Rebuild and explicitly approve an
`ian-layered-scene-plan-v1` and v2 package for every affected Ian shot before
continuing. A relaxed rule never auto-approves migrated bytes.
