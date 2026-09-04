# Illustrated flipbook storyboard branch

This conditional contract applies only when the locked post-cover style selection has
`style_id: illustrated-flipbook`. The immutable profile authority is
`leverage-video/src/shared/flipbook-video/profile.mjs`. It overrides only the
static-picture, route, body-text and rhythm clauses described below. All narration,
audio, review, transition, approval, caption, sound-design and delivery gates remain
active. Other styles retain their existing requirements.

## Direction and static spread

The current v3 direction map, every row and its `user_selection` record
`presentation_mode: illustrated-flipbook`. The ordinary style-selection, profile
and cohesion bindings remain mandatory and must match the locked episode style.
The top-level map, rows and downstream shot objects must agree; a row flag alone
cannot activate this branch. These fields are part of the presented-map hash.

Use only `ian-handdrawn-ppt` or `imagegen`, with `white_cat_recommendation.recommended:
false` and `user_selection.white_cat_present: false`. Ian remains the default for
structured explanations, ImageGen for narrative scenes. Both are selectable when
their unchanged structure and treatment contracts pass. Preserve the actual
`scene_class`; never turn a narrative into a structured graphic to enable Ian.
Ian keeps `ian-handdrawn-technical`; ImageGen keeps a compatible approved treatment.

One shot is one spread, one complete static 16:9 image, and one continuous exact
narration span. Both routes use `knowledge-video-static-spread-v1`, not an Ian
layered package, retired static Ian contract, action family or transparent layer
set. Do not plan subtitle reserve space inside the source picture. Page margins,
contain placement and readability at the final half-page size are still required.

Create the data with `buildStaticSpread(sourceText)` from
`leverage-video/src/shared/storyboard/static-spread.mjs`. Copy the exact object to
`row.static_spread`, `row.user_selection.static_spread`, the rhythm shot and queue
item. It contains exactly the contract identifier, `source_text`, and its UTF-8
`source_text_sha256`. A detailed shot section includes:

```text
- 图文双页：`knowledge-video-static-spread-v1`；精确计划 `<JSON of static_spread>`。
```

The existing Summary remains seven columns: its `可见文字` cell describes short
image labels; its `锁稿原文` cell contains the full exact body text. Keep punctuation,
whitespace and order. Do not duplicate the Summary into narration coverage.

## Complete text review

The same complete `visible-text-batch-review-v1` must include both the unchanged
short-label tuple and `body_text_contract: locked-narration-spread-body-v1` with
`static_spread` for every shot, including short-label mode `none`. Present image
labels and the full book-page body as distinct columns or clearly named blocks.
One exact whole-map approval binds both. Direction approval and one-click policy
never replace this text approval.

Image labels retain `concise-summary-visible-text-v1`, including its 28-code-point
limit. The book-page body is independently compared byte for byte with the locked
narration; it is not shortened, paraphrased or stripped of punctuation. Bottom
captions remain a separate later three-way delivery choice. Choosing no captions
never removes the book-page body.

## Rhythm and timing

Keep `storyboard-visual-rhythm-v2`, its density selection and map approval. The
artifact and each shot carry the presentation mode above. Each shot uses:

- `motion_tier: static_spread`;
- `asset_plan.main_image_count: 1`, `layer_count: 0`, `pose_count: 0`;
- `asset_plan.information_density` equal to the selected `standard` or `rich`;
- a non-empty `asset_plan.diagram_detail` explaining the intended information and
  diagram detail, plus the normal `reuse_plan`;
- `performance_plan: null` and `intra_shot_transition_plan: []`.

Plan actual text reveals as ordered `information-reveal` events against validated
audio. Do not fabricate layered image events, character acting, poses or hero
ratios. No static shot enters the action-state schedule; retain a correctly bound
empty schedule set when the entire episode uses this branch. Each shot's exact
static object must equal its direction row. Long body copy is split at semantic
boundaries before approval; do not solve overflow with extreme font reduction or
audio stretching.

The webpage adapter binds UTF-8 reveal ranges, font-ready measured layout,
persisted random image side, automatic timeline and the registered real
`book-page-turn` boundary. Approve every nonterminal visible boundary at 0.3–0.6
seconds under the shared transition contract. Finish the current body's reveal
before turning and align the next page to its narration. Never label a real page
turn as `cut`. The final clean hold remains exempt. Sound design uses actual page
turns and normally records silent body reveals with a reason; no layered Ian SFX
are invented.

## Verification

`validateStaticSpread` checks exact text and hash. The direction and rhythm
validators reject mismatched mode, cats, unsupported routes, multiple images,
layer/pose plans and stale map approvals. Final storyboard QA reads the detailed
static contract and compares it with the exact narration and rhythm. Visual
production additionally verifies prompt constraints and the approved image at
half-page size. The browser adapter proves layout, text coverage and real page-turn
timing; none of these checks grants approval itself.
