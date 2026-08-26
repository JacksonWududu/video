# Visual Asset Review v2

Manual applies `visual-asset-review-v2`/`hybrid_batch_v1` unchanged. One-click applies `visual-asset-review-v3`/`one_click_final_review_v1` to every generated asset, Whiteboard stage, and local-video source. `sequential_per_image` and `batch_final_review` remain legacy read-only. The shared `cover.png` does not enter the queue.

In one-click, every candidate still passes all route, technical, semantic, identity, continuity, white-cat and dependency QA. A passing item is `qa_passed_pending_final_review`; this status may unlock only true dependent generation and is never user approval. Do not create batch or per-item decision evidence. After all items pass, build one ordered exact ID/path/SHA-256 map, set `awaiting_precomposition_visual_review`, then run `approve-one-click-final-review.py present`. It must generate and bind `final-production-asset-review-package-v1`: one digest-named image-rich HTML page, its JSON manifest, 1920×1080 paged overview sheets, and one cumulative-layer sheet per Ian package. Present that page and stop. Only explicit approval bound to that complete current map and checksum-current package changes items to `approved` and locks visuals. Then immediately ask the caption three-choice question. Before the choice, still, Studio, preview, composition, and render are forbidden.

An Ian item is one review item but its approval object is the complete `ian-knowledge-video-layered-scene-v2` package. Manual batch, strict, and one-click payloads must include the package-manifest checksum, scene-plan checksum, the one source-master generation/model-observation record, and ordered source master/normalized master/background/pre-text layer/final layer/final-composite member map with exact paths, SHA-256 values, dimensions, and alpha roles. Include the checksum-bound split/text-overlay records and `ian-layer-text-container-qa-spec-v2` 8 px containment evidence when text is required. Present the deterministic final composite for visual judgment, but never reduce approval to that preview checksum. Approval and lock reread every member, replay normalization/splitting/text overlay, and recomposite the package from disk. The `gpt-image/2.0` embedded software-agent record is an observation, not cryptographic signature verification.

If the user requests a named pixel revision while that one-click map is pending, call `leverage-video/src/shared/visual-assets/request-one-click-asset-change.py`. It must verify and archive the complete pending map and its bound review-package paths/checksums, clear the active digest/package binding, preserve every unaffected item byte-for-byte, requeue only the named item and its real dependents, and return to `visual_production`. After fresh QA, recompute the complete map and generate a new digest-named image-rich HTML package containing all current assets, including unchanged reused images. Present the new page for complete visual re-review. The superseded digest and page can never be approved, and no prior whole-map decision carries forward.

## Soft cohesion overview at the existing final review

As mandatory cohesion QA inside the last existing Visual Asset Review, build one
overview: in manual mode, include it with the final already-required asset approval;
in one-click mode, include it with the existing complete exact asset list. Run:

```bash
node leverage-video/src/shared/visual-assets/build-visual-cohesion-overview.mjs <episode-workspace> <output.png>
```

The output argument may be a bare filename, which is placed under
`<episode-workspace>/assets/image/review/`, or a repository-root-relative path
inside that directory. Select exactly one representative per shot in storyboard
order: the master for ImageGen/Xuan/Ink, Ian's final composite, and Whiteboard's
region preview. Exclude the fixed cover and local-video shots. The overview is an
exact `1920×1080` PNG; every thumbnail uses proportional contain plus padding
and is never stretched.

This adds no new Gate or user reply. If the command fails, show representative
images sequentially in storyboard/shot order; inability to inspect the complete
ordered set blocks visual lock. Record `episode-visual-cohesion-qa-v1` in state
with the style-selection SHA-256, cohesion ID, exact ordered non-local asset IDs,
overview path/checksum, empty `anomalies`, and `result: pass`. Record exactly one
human-readable result: `无明显跳脱`, or one or
more `镜头 ID + 突兀原因`. Compare against the bound `visual_cohesion_profile_id`
for palette family, luminance, saturation, negative space, line weight, visual
density, and adjacent-shot visual weight. Ian and white-cat medium differences are
expected, but they do not excuse an unexplained jump in those shared dimensions.
Any named anomaly rejects the affected item before approval/lock and returns it
through the same approved route, style/cohesion binding, and normal QA; every
revision rebuilds the overview and applicable review package. The overview remains
part of the existing approval target and never authorizes an automatic restyle.

## Ordered generation and strict barriers

- Maintain one ordered `visual_asset_review.queue` in `schema/episode-state.json`. Queue order follows storyboard and real dependency order; batching never changes generation order.
- Queue order follows storyboard/dependency order. A character family always queues its master before its action variants.
- Partition active items without disturbing those dependencies: every non-`local-video-file` item first, then every local-video item in storyboard order. A non-local item after the first local-video item is invalid. Do not read or process a local-video source while any non-local item remains unapproved.
- Never regroup or prioritize the queue by recurring-character appearance, character identity, asset type, or production convenience. Preserve the actual storyboard order; within one storyboard shot, keep `master → action-01 → action-02 → ...`.
- Generate and technically QA only the current item. Non-strict QA may unlock the next item; never batch an image-generation call.
- Count every distinct QA-rejected generated output under `storyboard-image-generation-attempt-limit-v1`, regardless of route. The third rejection for one stable logical asset pauses the full queue and requires user takeover; prompt, reference, base, composition, model, route, path, version, and revision changes never reset the count. Do not generate a fourth automatic attempt or advance to a later queue item.
- Strict per-item review applies to recurring-character and white-cat masters, every master with downstream action variants, all Whiteboard stages, every deferred local-video item, user-marked strict items, and every revision after a change request. A strict barrier first closes and presents any pending normal batch, then blocks later work until its exact bytes are approved.
- Normal items pause for user review after four QA-passing items, before a strict barrier, or at queue end.
- Allowed statuses include `pending_generation`, `awaiting_batch_qa`, `qa_passed_pending_batch_review`, `awaiting_user_approval`, `approved`, `changes_requested`, `rejected`, and `superseded`.
- Before generation, call `require_generation_allowed` from `scripts/validate_visual_approval_state.py`. A normal item with `qa_passed_pending_batch_review` may unlock the next normal item in the same batch; an unresolved strict item, missing dependency, pause boundary, or non-QA-passing current item blocks later generation. This function rejects `local-video-file`; use the deferred import path only after the queue reaches its final local-video partition.

## Present exact bytes and stop

1. For every AI-generated storyboard image, include the exact phrase `16:9 landscape composition` in the production prompt and request an explicit 16:9 aspect-ratio or size parameter when the generator exposes one. Generate one versioned source asset and run its technical, identity/style, semantic, and continuity QA.
2. Decode and measure the generated source. Require landscape orientation and a relative aspect-ratio error no greater than `0.5%` from `16:9`; prompt text and model metadata alone are insufficient. Reject every output outside that tolerance before presentation.
3. Enforce the selected route's visible-text policy before presentation. `imagegen` with `white_cat_present: true` must contain no visible word, numeral, label, top title, signature, watermark, or accidental glyph. Every `xuan-paper-diorama` asset is subject to the same text prohibition and must also match the pinned style-profile/Skill checksums, four-to-seven paper depth planes, paper-material cues, and exact prompt/reference provenance. No-cat ordinary imagegen, each Ian semantic layer/final composite, Ink Doodle Knowledge Card, and Whiteboard must match their own approved exact text contract. Reject retired `comic-imagegen` and `doodle-slides`. Visual Asset Review verifies implementation only and cannot change mode, copy, placement, layer membership, or entry timing without reopening the bound authority.
   In particular, it cannot change mode, copy, or placement without reopening v3.
4. For ordinary raster routes, derive a separate exact `1920×1080` composition raster only after the near-16:9 source is approved. Use deterministic proportional scale-to-cover plus the smallest centered edge crop needed to reach exact 16:9; crop must remain within the same `0.5%` ratio tolerance. Never stretch or pad. Ian instead reviews and approves its complete v2 package: its raw source master remains bound evidence, while normalized/split/text-overlay derivatives are replayed before package presentation.
5. Compute every governed byte's SHA-256. For ordinary raster items record `path`, checksum, dimensions, complete locked narration `source_text`, prompt/reference provenance, and QA. For Ian additionally record the package manifest, exact plan digest, ordered members, dimensions/alpha roles, and deterministic recomposition result. Strict items enter `awaiting_user_approval`; normal items use `record_hybrid_qa_pass`.
6. At each batch boundary, write `visual-asset-batch-manifest-v1` with ordered asset IDs and checksum map; each Ian member also carries its canonical package-review object. Compute `manifest_sha256`, present every exact visual with its evidence and complete narration, then stop. A contact sheet is optional QA only.
7. The user may approve the whole batch or named members. At decision time call `record_hybrid_batch_approval` with the repository root; it must resolve each selected repository-relative path without symlinks, reread the governed files, recompute SHA-256 and PNG dimensions/alpha roles, rebuild the active manifest, and require disk/current/presented/QA/manifest evidence to agree before binding the exact message/time. Ian additionally requires deterministic recomposition equality for the final composite. Apply the same repository-root disk check to hybrid strict `record_approval` and every Whiteboard stage approval. Standalone shorthand `1` remains explicit approval.
8. A named change calls `record_hybrid_changes_requested`. It invalidates that asset, its real dependents, and the batch manifest; already individually approved unchanged bytes remain approved. The revision becomes strict and never inherits approval.

## Deferred local-video items

- After every non-local item is explicitly approved and no active batch remains, resolve the next local-video item's exact approved absolute `.mp4` path. Process local-video items one at a time in storyboard order; never treat their earlier queue deferral as approval or omission.
- Require one unrotated native 1920×1080 H.264 video stream, a successful probe and full decode, a regular non-symlink source, exact archived checksum equality, and the exact shot target frame count at 30 fps. Source audio is muted and ignored.
- Bind `local-video-match-v1` with `playback_rate = source_duration_seconds / (target_duration_frames / 30)` and `match_status: matched`. Map the complete source interval to the exact shot frame count; trimming, looping, padding, interpolation, crop, stretch, redraw, or added text is forbidden.
- Present a matched preview plus exact source/archive checksum, media evidence, target seconds/frames, and playback rate. Approve it through the strict `record_approval` path; the validator rechecks current disk bytes and media evidence. Any changed source byte, path, target frames, or playback rate invalidates approval and downstream assembly.

If a file changed after presentation, stale approval fails. Freshly QA and rebuild its evidence/package before approval. When the user's exact post-edit message explicitly approves the current file, that same message may be bound after the current bytes pass fresh QA and disk verification; a general or pre-edit approval may not be reused.

When every active item is approved, run `python3 .agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py validate-locked <episode-workspace>/schema/episode-state.json --repository-root .`, record its `visual-assets-lock-verification-v1` digest, then set phase `visual_assets_locked` and lock the visual manifest. Run the same command again immediately before assembly. Storyboard approval, technical QA, a package entry, stored hashes without current disk verification, or general permission never substitutes for Visual Asset Review approval.

## Whiteboard three-stage item

- A `srt-whiteboard-animation` queue item contains ordered nested records `source_image_review`, `annotation_review`, and `clip_review`; the parent item is `approved` only when all three are approved and checksum-current.
- Present the source PNG first. Only after approval derive and present the annotation JSON together with its static region-preview PNG. Only after both are approved render and present the silent MP4 with `whiteboard-render-evidence-v1`.
- Source changes clear all three approvals and all Whiteboard derivatives. Annotation changes preserve source approval but clear annotation/clip approvals and their derivatives. Clip changes preserve source and annotation approvals but clear clip approval only.
- Batch review cannot bypass these nested dependencies. Any pending nested stage blocks the next queue item and assembly.

## Legacy review modes

Preserve existing `sequential_per_image` and `batch_final_review` episode semantics as read-only-compatible modes. Do not rewrite unchanged legacy state. `sequential_per_image` pauses after each image; `batch_final_review` keeps its QA-first complete-package approval behavior.

- Preserve the same ordered queue, master-before-variant dependencies, prompt/reference inputs, per-image technical/identity/semantic/continuity QA, exact paths, measured dimensions, and SHA-256 evidence.
- Replace the per-image pause with `qa_passed_pending_batch_review`: this status unlocks only the immediate next queued asset for generation, but it is not user approval and must not populate `approved_checksum_sha256`, `decision_message`, or `decision_time`.
- Generate each action variant independently from its QA-passing immutable master plus the canonical character reference. Batch review does not permit batching image-generation calls or deriving one variant from another.
- Do not create approval-dependent 1920×1080 derivatives, lock the visual manifest, set `visual_assets_locked`, or begin assembly until the user receives the complete batch review package and explicitly approves all exact presented bytes.
- The complete batch review package must present every pending asset with its exact path, SHA-256, dimensions, role, QA evidence, and complete locked narration `source_text` for the corresponding shot. Record a batch manifest checksum and the user's exact final decision message/time.
- A change request during batch review invalidates only the named asset/family and dependent outputs; regenerate the affected item from the proper immutable master, rebuild the batch manifest, and require final approval of the new exact-byte set.

## White-cat action families

- Feed the canonical white-cat v2 reference image as an actual identity/composition image input for every white-cat master and every action-variant edit. Recording only its path or checksum is insufficient.
- Generate and approve the master first. Treat its approved exact bytes as immutable.
- Generate each action variant independently from the unchanged approved master while also supplying the canonical v2 reference. Never derive a later variant from an earlier variant.
- The master is strict. After it is approved, action variants may enter normal four-item review batches unless the user marks them strict or they are revisions. A contact sheet remains QA only.

## Comic items

- Generate every page or progressive state with Codex native `imagegen` as one complete 1920×1080 PNG. Save a separate prompt path/checksum and the checksums of every actual reference input.
- Require `visible_text_mode: none`; reject bubbles, narration boxes, sound-effect lettering, generated labels, signatures, and watermarks.
- The character reference is strict. Complete page/state PNGs follow queue order and may enter normal review batches; do not use upstream batch generation, split panels after generation, assemble a PDF, or let Remotion crop/recompose the page.

## Existing or rejected assets

- Preserve rejected historical files as `superseded`; do not delete or silently reactivate them.
- An earlier asset counts as approved only when the ledger contains exact path/checksum presentation evidence and an explicit matching user decision. Technical QA, a manifest entry, storyboard approval, or a prior render does not substitute for visual approval.
- Any rejected active visual invalidates its affected family and all downstream compositions, previews, renders, and deliveries that consume it.
- For a revised storyboard, reconcile at shot level. Preserve an unchanged shot's queue status, exact-byte checksums, technical QA, and approval evidence; keep it active for the new storyboard with a recorded unchanged visual-contract binding. For a timing or narration-span-only change, keep the same bytes only after recording semantic/timing rebind QA. Mark only removed, replaced, or visual-contract-changed shots and their actual dependents inactive or `superseded`.
- Treat a batch manifest, review document, or contact sheet as a package over member assets. If shot membership, order, or bound narration changes, mark the package for rebuild and present the new package before batch approval. Package rebuild does not erase or downgrade the unaffected member images' QA or exact-byte approval evidence.
