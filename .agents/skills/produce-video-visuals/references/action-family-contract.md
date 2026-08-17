# Master-derived action-family contract

## Family structure

- Apply this contract to every narrative illustration containing the recurring cat or another `performing character`, except a no-cat shot explicitly approved for `srt-whiteboard-animation`.
- The sole route-specific exemption is `whiteboard-element-sequence-replaces-action-family-v1`: use one approved full-panorama source and its approved ordered drawing elements instead of the image-state family required by `action-state-schedule-v2`. It is illegal when `white_cat_present: true`, and it does not weaken action-family or watercolor rules for any other route.
- Exempt character-free narrative plates, data visualizations, transition/graphic scenes, and standardized low-expression human or animal glyphs explicitly classified as `symbolic information token`s. If a glyph gains individualized pose, gaze, emotion, contact, weight shift, or cause-and-effect performance, reclassify the shot as a narrative illustration and apply this contract; never relabel a performing character as a token to reduce asset count.
- Treat the approved master as immutable.
- Use `action-state-schedule-v2` after the real 30 fps shot duration `F` is known. Compute `preferred = clamp(floor(F / 45 + 0.5), 1, 5)`, `required_for_max_hold = ceil(F / 75)`, and `state_count_total = max(preferred, required_for_max_hold)` mechanically.
- If `state_count_total > 5`, split the shot at a natural semantic pause. Never add a sixth state.
- Set `action_variant_count = state_count_total - 1` and register `base/master → action-01 → …`. One-image families with zero variants are valid.
- Count one registered family per shot, not one family per target character. Record every moving target ID and freeze every non-target character; coordinated multi-character changes still use the same mechanically computed total.

## Generation rule

- Action or complete-state variants inherit the parent shot's approved `imagegen` or `xuan-paper-diorama` route; they are not independent route choices and never receive additional Visual Direction Review rows. A 宣纸 family preserves the same checksum-pinned style profile on every state. Historical `comic-imagegen` families are read-only and cannot receive a new state or derivative.
- Generate every action variant as a separate identity-preserving edit from the unchanged master.
- Never generate one variant from another and never repair a drifted variant by editing it again.
- Label `Image 1` as the edit target and the canonical character sheet as the identity/composition reference.
- State: `change only the designated character action/pose plus storyboard-declared interactive-prop/contact changes and necessary satchel/accessory follow-through; keep everything else unchanged`.
- Repeat all identity and composition invariants on every edit.
- Although every variant is generated independently from the unchanged master, provide its planned previous/current/next state as motion context. Independence of image source must not break the storyboard's action chain.

## Permitted and frozen changes

Permit only the named target character's pose, limb position, gesture, gaze, action-required expression, storyboard-declared interactive-prop/contact state, and the satchel, strap, drape, owl charm, and papyrus's physically necessary follow-through with the body. Unless the storyboard requires travel or turning, preserve scale, center position, facing, and depth; preserve every contact anchor not explicitly changed by the action plan.

Freeze the approved master's actual near-16:9 source dimensions, camera, crop, perspective, background, geometry, lighting, shadows, watercolor wash, paper texture, palette, all non-interactive props, subtitle-safe area, and all non-target characters. Keep the white cat's v2 satchel and accessory geometry identity-locked while allowing only the position/orientation change physically required by the declared body movement. The satchel remains on the anatomical right flank; approved camera or pose geometry may occlude it, but no edit may relocate it to the wrong side. Create exact 1920×1080 registered composition derivatives only after every source state is approved.

Freeze the route-resolved visible-text mode across the family. For `imagegen` with `white_cat_present: true`, it must remain `none`; never introduce or preserve thoughts, spoken words, top titles, labels, numerals, clocks, signs, interface strings, decorative lettering, signatures, or watermarks. A no-cat performing-character family follows its selected route's approved text contract and may not change that decision in an action variant. If a master violates its route policy, supersede it and regenerate every dependent state independently from a compliant unchanged master.

## Files and manifest

Use versioned names such as:

- `shot-03-master-v01.png`
- `shot-03-action-01-v01.png`
- `shot-03-action-02-v01.png`

Record `action-state-schedule-v2`, the mechanically chosen total, variant count, real shot frames, master checksum, edit prompt, target IDs, intended state role, output paths/checksums, and QA result in one action-family manifest. For every adjacent pair, also record action direction, facing, center-of-gravity shift, limb trajectory, contact points, prop/satchel/accessory position, causal link, physical-reachability result, and reviewer evidence.

## Family QA

Inspect the complete family at full resolution, as aligned overlays/difference views, at thumbnail scale, and in storyboard order as a timed stepped preview. For every state, first require exactly two forelegs and then exactly two hindlegs before accepting the four-limb total. If one forepaw is raised, exactly one other forepaw may be grounded; the remaining two grounded paws must belong to the two hindlegs. Reject any third foreleg or third forepaw. Review every `previous → current → next` transition, not only each image in isolation. Reject background/prop drift, camera/crop shift, changed light/palette, identity/satchel/accessory/tail/eye/beard errors, malformed anatomy, unexplained teleportation, reversed or contradictory action direction, impossible weight transfer or limb path, lost or newly invented contact, discontinuous props/satchel/accessories, broken cause-and-effect order, changed non-target characters, poor registration, an unreadable adjacent action, or any forbidden visible text. A family that passes character identity but fails action continuity or text QA is a blocker.

If targeted retries from the unchanged master cannot preserve locked regions, keep the valid master and report an action-family blocker.

## State schedule

- Divide `F` by `state_count_total`: the quotient is every base duration and the remainder adds one frame to each occurrence from front to back.
- A one-image family covers the whole shot and has an empty `intra_shot_transitions` array. For a multi-image family, every occurrence span is 18–75 frames and the schedule covers `[0, F)` without gaps or overlaps. Record `transition_in_frames = 0` for the first occurrence and `18` for every later occurrence; set `clean_hold_in_frames = duration_in_frames - transition_in_frames`, with at least 15 clean frames per occurrence.
- Join every adjacent state only with `intra-shot-watercolor-bloom-v1`: fixed `0.6` seconds, `18` frames at 30 fps, using `leverage-video/src/shared/watercolor-bloom`. Cross-dissolve, optical flow, morphing, generated in-betweens, and frame interpolation are forbidden.
- Revoice preserves the parent state count, IDs, and order. Redistribute only occurrence frames; block instead of recomputing states when a span falls outside 18–75 frames or a post-reveal clean hold falls below 15 frames.
- Keep camera/crop fixed and inspect the encoded result for stable registration, readable and physically coherent action progression, cadence, timing, and unintended flicker.
