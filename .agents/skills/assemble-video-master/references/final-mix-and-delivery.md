# Final mix and delivery contract

## BGM mode

- `bgm.mode` has two values: `disabled` and `enabled`; missing or unspecified state means `disabled`.
- Default `disabled`: do not read `default-bgm.txt`, enumerate the BGM library, inspect or copy a BGM file, create a BGM track, or ask whether to enable BGM. Record null BGM source fields and render narration plus only manifest-listed, QA-passing discrete sound effects.
- `enabled` requires the active episode state to contain the user's explicit enablement message and time. Do not infer enablement from an existing selector, BGM file, earlier unrelated episode, or prior default behavior.
- A `revoice_variant` inherits the parent BGM mode. `disabled` stays disabled. `enabled` may reuse only the parent episode's already archived, checksum-matching BGM source and mix policy after the variant composition lock; do not read the selector or resolve a different track.

## Enabled-mode BGM source

In the standard route, do not read the selector, a user-specified track, library metadata, or any BGM bytes until the active episode contains matching `composition_lock` evidence and complete `bgm.enablement` evidence. Require the BGM source-resolution time to be later than the composition lock time.

- Library root: `/Users/jackson/Documents/Codex/asset-library/audio/bgm`.
- Resolve the active default by reading `/Users/jackson/Documents/Codex/asset-library/audio/bgm/default-bgm.txt`.
- Do not depend on an original Desktop copy after archival.

Only in `enabled` mode, probe and fully decode the selected BGM. Record source path, shared-library path, checksum, codec, sample rate, channels, and duration.

In `revoice_variant`, skip selector and source resolution. After the variant composition lock, revalidate and fully decode only the parent episode's already archived BGM whose checksum is recorded in `visual_sequence_lock` and the revoice binding. A missing or changed archived source is a blocker; never substitute the current default.

When the user supplies a BGM for the active episode, validate that exact file, archive it non-destructively with a versioned filename under the active episode's `assets/audio/`, preserve earlier episode versions, and record provenance without claiming a broader license than the user supplied. Never update the shared library, its documentation, or `default-bgm.txt` from an episode request. A shared-default change requires a separate explicit `project_maintenance` request.

## Enabled-mode final mix

- Add BGM only after the exact composition duration is locked.
- Start BGM at video time zero.
- If longer, trim at the exact final duration; if shorter, loop from the beginning and trim the final repetition exactly.
- Cover the whole video without a gap.
- Keep narration and BGM as separate tracks and narration clearly dominant.
- Do not change narration, scene, transition, composition timing, or the selected caption role during mixing, and do not add a subtitle stream.
- Record `bgm.mix` with the exact composition-lock base checksum, BGM source checksum, mixed output checksum, and QA result. Never reuse a mix if either input checksum changed, even when duration is unchanged.

## Ian layer-entry sound effects

- Use only cues in a checksum-current `ian-layered-entry-effects-v2` map and an immutable registered shared sound-effect manifest. In a multi-layer shot, exactly 2–3 semantically important layers have cues at their exact `entry_frame`; every other layer is silent. The pre-trimmed derived stereo 44.1 kHz WAV must bind the original source path/SHA, semantic reason, trim sample range, derived path/SHA, cue frame/sample, role, and per-asset gain. Reject more than two uses of one source per shot, adjacent audible cues from the same timbre family, and pitch/speed-only pseudo-variation.
- Fixed class gains are paper/card 0.19, node/mechanism 0.44, contour/path 0.15, and broad-region reveal 0.23. Do not substitute a similar library item or alter one layer independently.
- Keep narration gain at 1 and `amix`/mix normalization disabled. Measure the rendered master peak. If it exceeds -1 dBFS, lower the one common bus multiplier used by both generic and Ian SFX, then rerender; never lower or rewrite narration. Narration-only and final-mix lineage must prove the narration bytes and gain are unchanged, and narration loudness drift may not exceed 0.5 dB.
- Missing, stale, duplicate, unapproved, wrong-frame, or wrong-gain cues block preview, render, composition lock, and delivery.

## Whole-storyboard sound effects

- Require one passing `knowledge-video-sound-design-v1` and exact top-level `sound_effects` projection in every current v3 assembly plan. Verify complete candidate-event coverage, explicit silent decisions, exact source/derived SHA-256 values, cue frames, roles, intensity, render owners, density/conflict checks, official license observation, active library revision, and canonical map hash.
- Render generic cues only through `SoundEffectTrack` and Ian cues only through `IanLayeredScene`. Across both renderers, each audible event appears once and only once. Non-Ian shots carry at most two cues; strong cues remain at least 30 frames apart; no generic cue may remain within 12 frames of an Ian cue. Runtime trim, time stretch, pitch shift, approximate substitution, and unlisted audio are forbidden.

## Caption-delivery mode and shared horizontal masters

- Require `caption_delivery.mode` and its exact choice evidence before rendering. Under `required_delivery_roles`, `caption_free_only` requires `caption_free_master`, `captioned_only` requires `captioned_master`, and `both` requires both master roles. Mechanically derive matching `required_internal_qa_roles`: `caption_free_first_shot_prefix`, `captioned_first_shot_prefix`, or both. Render no role outside the union of those two sets.
- Render every required delivery master as a native 1920×1080, 16:9 landscape, 30 fps MP4/H.264 file for both Douyin and Bilibili validation. `caption_free_only` means one delivered MP4, `captioned_only` means one delivered MP4, and `both` means two delivered MP4s. Every master begins directly with S01; no publishing cover or standalone opening composition enters it.
- Do not stretch, crop, pad, or embed a 9:16 asset into the horizontal canvas, and do not produce duplicate vertical scene variants. Regenerate or recompose mismatched visuals natively.
- Keep essential characters, data, formulas, and text inside horizontal title/action-safe margins.
- Platform metadata may differ; within each role, delivered pixels, narration, timing, caption role, and BGM mode must remain identical. When BGM is enabled, the BGM track must also remain identical. In `both`, the two full masters and their internal first-shot-prefix QA renders must share every non-caption input fingerprint and frame schedule; only the caption layer may differ.

## Internal first-shot-prefix QA render

- Render one separate 1920×1080, 16:9, 30 fps H.264 first-shot-prefix MP4 for each required master role from the exact source-derived composition and caption mode used at frame 0 of that master. Store it only under the episode workspace's `assets/video/` as internal prefix-QA evidence; it is not a user deliverable.
- Under `direct-first-shot-v1`, require each prefix's exact duration to be `first_sentence_end_frame`; require its S01 frames to match its same-caption-role full-master prefix by loss-tolerant decoded-frame comparison, not encoded-byte identity.
- In BGM-disabled mode, each prefix contains the validated narration master's first-sentence interval over S01 beginning at frame 0. In BGM-enabled mode, use the same final BGM policy as its full master for that interval. A captioned prefix begins its first cue with narration at frame 0; a caption-free prefix has no bottom narration caption. Publishing-cover pixels are forbidden.

## Final QA

- Use `ffprobe` on every required delivery master and internal first-shot-prefix QA render to verify streams, codecs, exact 1920×1080 dimensions, 16:9 display aspect, frame rate, duration, and zero subtitle streams.
- Decode the entire file without errors.
- Verify A/V sync, intelligible narration, black frames, representative playback, and role-appropriate whole-film contact-sheet evidence. Confirm `S01` and narration begin at frame zero, the first sentence is fully covered by approved S01 imagery, no publishing cover, `OPEN-00`, added opening text layer, or retired opening source is present, and the final duration equals `narration_master_frames`. For caption-free roles, confirm no mounted caption component, no burned-in bottom narration captions, and no accidental transcript-like overlays. For captioned roles, confirm exactly one versioned caption component, cue text/timing/checksum equality, safe-area and line-wrap compliance, and expected burned-in captions with no extra transcript-like text. Separately approved route-owned raster/annotation text remains valid; verify that no generic top-title layer was mounted and that ordinary white-cat `imagegen` remains text-free. Verify every included sound effect appears in the active sound-effect manifest with matching path/checksum/cue and that no unlisted effect is present. In `disabled` mode, confirm the render provenance and composition contain no BGM input or track. In `enabled` mode, verify full BGM coverage, clear narration dominance, and exact mix input fingerprints.
- For current v3 output, run `node .agents/skills/assemble-video-master/scripts/validate-render-sound-mix.mjs <assembly-plan.json> <render.mp4>`. Require one mixed audio stream, narration gain `1`, disabled normalization, the recorded common SFX bus, no BGM in disabled mode, and measured peak at or below `-1 dBFS`. On overflow, change only `bus_gain_multiplier`, invalidate the sound plan/render evidence, rerender, and repeat.
- Probe and fully decode every required internal first-shot-prefix MP4; verify exact 1920×1080, 30 fps, H.264, zero subtitle streams, exact frame count, expected audio and caption mode, first-sentence A/V sync, absence of publishing-cover pixels, and decoded-frame correspondence with the same interval of its same-caption-role full master.
- Confirm every final render traces to the locked script, narration, storyboard, visual asset manifest, sound-effect manifest, composition lock, `caption_delivery`, `bgm.mode`, and any enabled-mode mix version. In `both`, verify matching duration/audio/timing/visual-order fingerprints across roles and record the caption layer as the only permitted difference.
- For `revoice_variant`, confirm the render also traces to the parent delivery lineage, replacement narration, approved retiming-only storyboard, and passing `revoice-visual-binding`; compare the full ordered visual sequence against `visual_sequence_lock`.

## Delivery

- Fixed directory: `/Users/jackson/Desktop/video-edit/video-resource`.
- Resolve and validate the exact directory before writing; create it only inside this authorized path and request runtime filesystem approval when required.
- Before copying, create a new active delivery transaction ID and repository-relative JSON manifest under the episode workspace's `schema/`. Use that manifest—not a raw directory listing—as the authoritative role set for the current episode or variant. Never remove, overwrite, or count unrelated or historical files already present in the shared directory.
- Use role-explicit new versioned delivery filenames only for full masters: `<topic-slug>-caption-free-final-v01.mp4` and `<topic-slug>-captioned-final-v01.mp4` as selected. Never overwrite an existing delivery.
- For `revoice_variant`, include the variant identity before the role, for example `<topic-slug>-revoice-<variant-id>-captioned-final-v01.mp4`.
- Copy only the QA-approved full masters in `required_delivery_roles` non-destructively and list no unselected delivery role in the active delivery transaction manifest. Do not copy or return the standalone per-topic opening, and never list an opening role in the manifest.
- Compare source/destination checksum and size for every selected full-master role, then probe and fully decode every delivered copy. Require the active transaction manifest's actual role set to equal `required_delivery_roles` exactly; fewer, extra, or mismatched full-master roles within that transaction are a delivery failure. Historical versioned files outside the transaction are not extra roles.
- Deliver no SRT, VTT, ASS, or other subtitle sidecar with the master.
- Do not call delivery complete until every full-master role in `required_delivery_roles` exists in the fixed directory with matching checksum and passing QA, every corresponding internal first-shot-prefix QA role has passing evidence inside the episode workspace, and the active transaction manifest itself is checksum-recorded in episode state.
- Return clickable links to every delivered complete full video, approved narration master, and role-appropriate contact-sheet evidence. A separate publishing cover may be linked only when requested; do not expose the internal first-shot-prefix file as a user deliverable.
