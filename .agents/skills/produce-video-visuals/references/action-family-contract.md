# Master-derived action-family contract

## Family structure

- Apply this contract to every narrative illustration containing the recurring cat or another `performing character`, except a no-cat shot explicitly approved for `srt-whiteboard-animation` or `local-video-file`.
- Route-specific exemptions are `whiteboard-element-sequence-replaces-action-family-v1` and `local-video-source-replaces-image-action-family-v1`. Whiteboard uses one approved full-panorama source and ordered drawing elements. Local video uses its one exact-byte-approved complete source clip with matched playback and no generated image states. Both are illegal when `white_cat_present: true`, and neither weakens another route's action-family or v3 transition contract.
- Exempt character-free narrative plates, data visualizations, transition/graphic scenes, and standardized low-expression human or animal glyphs explicitly classified as `symbolic information token`s. If a glyph gains individualized pose, gaze, emotion, contact, weight shift, or cause-and-effect performance, reclassify the shot as a narrative illustration and apply this contract; never relabel a performing character as a token to reduce asset count.
- Treat the approved master as immutable.
- Use `action-state-schedule-v4` after real audio, exact shot text, and density selection are known. Standard retains stateful 2–4 and `hero_pose` 4–6. Rich stateful targets 4–6/hard 2–6; rich hero targets 10–12 total/hard one background plus 4–13 poses. Apply the exact fallback and 13–14 total split/quantity rules from the workflow authority. Legacy `action-state-schedule-v3` is read-only.
- The old duration formula is only a cadence advisory in v3 and never determines asset count. If more than five continuous poses/states are proposed, assess a semantic split first. Only when no natural split exists may exact shot/map-hash approval authorize the sixth `hero_pose`; `stateful` never exceeds four.
- Give every state a stable unique `state_id`, unique non-empty `semantic_state`, exact gap-free UTF-8 narration byte range/text, and real-audio `at_frame`. If there are not two independent complete-scene states, do not fabricate `stateful`; use `layered` or another single-image contract.
- Count one registered family per shot, not one family per target character. Record every moving target ID and freeze every non-target character; coordinated multi-character changes use the same approved semantic state plan.
- `action-state-schedule-v2` is unchanged history only: its formula, one-to-five states, quotient/remainder timing, and mandatory watercolor chain must not be migrated implicitly.

## Generation rule

- Action or complete-state variants inherit the parent shot's approved `imagegen` or `xuan-paper-diorama` route; they are not independent route choices and never receive additional Visual Direction Review rows. A 宣纸 family preserves the same checksum-pinned style profile on every state. Historical `comic-imagegen` families are read-only and cannot receive a new state or derivative.
- Generate every action variant as a separate identity-preserving edit from the unchanged master.
- Never generate one variant from another and never repair a drifted variant by editing it again.
- Label `Image 1` as the edit target and the canonical character sheet as the identity/composition reference.
- State: `change only the designated character action/pose plus storyboard-declared interactive-prop/contact changes and necessary satchel/accessory follow-through; keep everything else unchanged`.
- Repeat all identity and composition invariants on every edit.
- Although every variant is generated independently from the unchanged master, provide its planned previous/current/next state as motion context. Independence of image source must not break the storyboard's action chain.
- For `stateful`, every output is a complete registered scene and inherits the exact locked camera, background, scale, lighting, and spatial relationships. For `hero_pose`, approve the background and character/core-object design first, then generate transparent pose assets whose registration anchors are fixed.

## Permitted and frozen changes

Permit only the named target character's pose, limb position, gesture, gaze, action-required expression, storyboard-declared interactive-prop/contact state, and the satchel, strap, drape, owl charm, and papyrus's physically necessary follow-through with the body. Unless the storyboard requires travel or turning, preserve scale, center position, facing, and depth; preserve every contact anchor not explicitly changed by the action plan.

Freeze the approved master's actual near-16:9 source dimensions, camera, crop, perspective, background, geometry, lighting, shadows, watercolor wash, paper texture, palette, all non-interactive props, subtitle-safe area, and all non-target characters. Keep the white cat's v2 satchel and accessory geometry identity-locked while allowing only the position/orientation change physically required by the declared body movement. The satchel remains on the anatomical right flank; approved camera or pose geometry may occlude it, but no edit may relocate it to the wrong side. Create exact 1920×1080 registered composition derivatives only after every source state is approved.

Freeze the route-resolved visible-text mode across the family. For `imagegen` with `white_cat_present: true`, it must remain `none`; never introduce or preserve thoughts, spoken words, top titles, labels, numerals, clocks, signs, interface strings, decorative lettering, signatures, or watermarks. A no-cat performing-character family follows its selected route's approved text contract and may not change that decision in an action variant. If a master violates its route policy, supersede it and regenerate every dependent state independently from a compliant unchanged master.

## Files and manifest

Use versioned names such as:

- `shot-03-master-v01.png`
- `shot-03-action-01-v01.png`
- `shot-03-action-02-v01.png`

Record v4 density mode/selection hash, canonical plan hash, fallback/split evidence, semantic total, exact UTF-8 ranges, frames, separate background checksum, target IDs/order, exact `intra-shot-transition-v1` map, and QA. The background never enters occurrences; require `pose_count - 1` transitions and at least 15 clean frames per state. Preserve all adjacent-pair continuity evidence.

## Family QA

Inspect every new or explicitly rebuilt white-cat state independently under `white-cat-anatomy-qa-v2` at original resolution with exact `F1/F2/H1/H2`, unique paws, an independent-byte fully decodable numbered PNG bound to the source SHA-256 and limb IDs, and reverse-assignment evidence before continuity review. For `xuan-paper-diorama`, repeat this check on each final normalized 1920×1080 white-cat PNG; pre-normalization evidence does not transfer. Then inspect the complete family as overlays, thumbnails, and a timed stepped preview. P0 anatomy and applicable P2 bag geometry are per-image blockers; continuity cannot hide a malformed or ambiguous limb.
Review every `previous → current → next` transition. Reject background/camera/light drift, identity or accessory errors, teleportation, reversed action, impossible weight transfer or limb paths, lost/invented contacts, broken causality, poor registration, unreadable adjacent action, or forbidden text.

If targeted retries from the unchanged master cannot preserve locked regions, keep the valid master and report an action-family blocker.

## State schedule

- The first state starts at frame 0; later states enter at real-audio semantic points. Occurrences cover `[0, F)` consecutively. Narration byte ranges are ordered, non-overlapping, and cover the exact shot source once. A state over 75 frames requires a semantic hold reason.
- Store exactly `N - 1` `intra-shot-transition-v1` entries. Default `cut` is zero frames and requires the target to retain at least 15 clean frames. Optional `watercolor-bloom` is fixed to 18 frames, requires explicit user selection bound to the active visual-rhythm map, and requires at least 33 target frames total. Missing, `none`, unknown, unapproved, or unsupported effects block; there is no renderer fallback.
- Cross-dissolve, optical flow, morphing, generated in-betweens, and frame interpolation are forbidden.
- Revoice preserves IDs, semantics, byte ranges, order, assets, camera, and every effect. Recompute only entry/end frames from replacement audio. If the unchanged map cannot retain minimum clean holds, block instead of dropping a state or changing an effect.
- Keep registration fixed and inspect the encoded result for readable physical action, contact/weight, impact, recoil, follow-through, cadence, timing, and flicker.
