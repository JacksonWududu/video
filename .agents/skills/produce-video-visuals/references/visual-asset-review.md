# Visual Asset Review v2

Apply `visual-asset-review-v2` to every generated episode visual asset. New and modified work defaults to `mode: hybrid_batch_v1` and `batch_size: 4`. `sequential_per_image` and `batch_final_review` remain readable for legacy episodes only; do not migrate them automatically. The exact shared `cover.png` governed by `cover-only-v1` does not enter the queue.

## Ordered generation and strict barriers

- Maintain one ordered `visual_asset_review.queue` in `schema/episode-state.json`. Queue order follows storyboard and real dependency order; batching never changes generation order.
- Queue order follows storyboard/dependency order. A character family always queues its master before its action variants.
- Never regroup or prioritize the queue by recurring-character appearance, character identity, asset type, or production convenience. Preserve the actual storyboard order; within one storyboard shot, keep `master → action-01 → action-02 → ...`.
- Generate and technically QA only the current item. Non-strict QA may unlock the next item; never batch an image-generation call.
- Strict per-item review applies to recurring-character and white-cat masters, every master with downstream action variants, all Whiteboard stages, user-marked strict items, and every revision after a change request. A strict barrier first closes and presents any pending normal batch, then blocks later work until its exact bytes are approved.
- Normal items pause for user review after four QA-passing items, before a strict barrier, or at queue end.
- Allowed statuses include `pending_generation`, `awaiting_batch_qa`, `qa_passed_pending_batch_review`, `awaiting_user_approval`, `approved`, `changes_requested`, `rejected`, and `superseded`.
- Before generation, call `require_generation_allowed` from `scripts/validate_visual_approval_state.py`. A normal item with `qa_passed_pending_batch_review` may unlock the next normal item in the same batch; an unresolved strict item, missing dependency, pause boundary, or non-QA-passing current item blocks later generation.

## Present exact bytes and stop

1. For every AI-generated storyboard image, include the exact phrase `16:9 landscape composition` in the production prompt and request an explicit 16:9 aspect-ratio or size parameter when the generator exposes one. Generate one versioned source asset and run its technical, identity/style, semantic, and continuity QA.
2. Decode and measure the generated source. Require landscape orientation and a relative aspect-ratio error no greater than `0.5%` from `16:9`; prompt text and model metadata alone are insufficient. Reject every output outside that tolerance before presentation.
3. Enforce the selected route's visible-text policy before presentation. `imagegen` with `white_cat_present: true` must contain no visible word, numeral, label, top title, signature, watermark, or accidental glyph. Every `xuan-paper-diorama` asset is subject to the same text prohibition and must also match the pinned style-profile/Skill checksums, four-to-seven paper depth planes, paper-material cues, and exact prompt/reference provenance. No-cat ordinary imagegen, Ian, Ink Doodle Knowledge Card, and Whiteboard must match their own approved exact raster/annotation text contract. Reject retired `comic-imagegen` and `doodle-slides`. Visual Asset Review verifies implementation only and cannot change mode, copy, or placement without reopening v3 and Storyboard Review.
4. Derive a separate exact `1920×1080` composition raster only after the near-16:9 source is approved. Use deterministic proportional scale-to-cover plus the smallest centered edge crop needed to reach exact 16:9; crop must remain within the same `0.5%` ratio tolerance. Never stretch or pad. The approved source remains the visual approval object.
5. Compute the asset's exact-byte SHA-256. Independently record `path`, checksum, dimensions, complete locked narration `source_text`, prompt/reference provenance, and QA. Strict items enter `awaiting_user_approval`; normal items use `record_hybrid_qa_pass`.
6. At each batch boundary, write `visual-asset-batch-manifest-v1` with ordered asset IDs and checksum map, compute `manifest_sha256`, present every exact image with its evidence and complete narration, then stop. A contact sheet is optional QA only.
7. The user may approve the whole batch or named members. At decision time call `record_hybrid_batch_approval` with the repository root; it must resolve each selected repository-relative path without symlinks, reread the file, recompute SHA-256 and PNG dimensions, rebuild the active manifest, and require disk/current/presented/QA/manifest evidence to agree before binding the exact message/time. Apply the same repository-root disk check to hybrid strict `record_approval` and every Whiteboard stage approval. Standalone shorthand `1` remains explicit approval.
8. A named change calls `record_hybrid_changes_requested`. It invalidates that asset, its real dependents, and the batch manifest; already individually approved unchanged bytes remain approved. The revision becomes strict and never inherits approval.

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
