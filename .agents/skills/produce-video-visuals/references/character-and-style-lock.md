# White-cat identity and visual-style lock

## Canonical identity source

- Canonical root: `/Users/jackson/Documents/Codex/character-library`.
- Identity reference: `/Users/jackson/Documents/Codex/character-library/white-cat/v2/white-cat-reference.png`.
- Approved SHA-256: `8d4d2fc6a4283cd05dfbb273d79cf1c13b062f79e2a5f945c1d5982a22a15c1f`.
- Character bible: `/Users/jackson/Documents/Codex/character-library/white-cat/v2/character-bible.md`.

Verify the reference checksum and read the character bible before generating or revising any image containing the recurring cat. A missing or changed canonical asset is a blocker and requires explicit user approval as a new character version.

Never use a project-local mirror, cache, historical export, or episode copy as an identity/design source. Episode projects may store generated shot images and provenance records only.

## Locked identity traits

- one recurring character, not six cats from the pose sheet;
- broad round face;
- short, stocky, fluffy body;
- ivory-white fur;
- very large bright-blue eyes;
- moderately heavy soft smoky slate-blue/violet-gray scholarly under-eye circles;
- triangular alert ears;
- peach-pink nose;
- short curly white Socratic beard ending around the upper chest;
- plume tail with stable warm-gray bands and a warm taupe tip;
- ivory himation over the anatomical right shoulder with muted-cobalt Greek-key trim;
- one Aegean-blue satchel on the anatomical right flank with exactly two wide plain blue strap paths and exactly two opposite bag-end attachments;
- the front strap crosses the front of the lower neck/upper chest and attaches continuously to the bag's forward end nearest the chest; the rear strap passes behind the neck/over the upper back and attaches continuously to the bag's rear end nearest the hindquarters;
- require one strap per opposite bag end, never both on one end or at the bag center; keep every exposed path traceable through `neck/shoulder → wide plain strap → bag-end ring/loop → blue bag body`;
- the narrow patterned himation trim is clothing, not a strap, and may never substitute for either connection; a strap stopping on the chest, owl charm, robe, trim, or papyrus pocket is invalid;
- centered aged-bronze olive-leaf clasp, blank papyrus in the right-side pocket, small aged-bronze owl charm near the anatomical left chest, and ivory-cobalt collar.

Keep the satchel visible in every cat shot unless it is physically occluded by the approved camera or pose. Perspective may hide an accessory, but never relocate it to the wrong side merely to keep it visible. Do not change the himation, satchel, two strap paths, opposite bag-end attachments, clasp, papyrus, owl charm, collar, eye circles, beard, eyes, fur, or tail, or introduce extra characters unless the user explicitly requests a new identity version. Pose, expression, gaze, camera view, and scene may vary while identity remains locked.

Label the sheet as `identity/composition reference`, never as a multi-cat layout source.

## Locked style

Use the exact episode-wide readable v1 or current `white-cat-visual-style-selection-v2`; never default, mix, or override it per shot. V2 binds an immutable episode-local profile checksum even when its source was registered globally. All storyboard choices target a 16:9 landscape canvas within `0.5%` relative aspect-ratio error; exact 1920×1080 is required for the later composition derivative.

- `loose-line-vivid-watercolor` (松线明彩水彩): warm off-white cold-press paper, transparent luminous watercolor washes, irregular brushed edges/exposed paper, and sparse loose broken black-brown charcoal/dry-ink contours.
- `twilight-neon-animation` (暮紫霓影动画): use the exact saved profile's twilight blue-violet animation language, luminous periwinkle/rose-coral accents, restrained bloom, clean cinematic forms, and its negative rules; preserve the same canonical cat identity without importing any prior pose, text, or scene geometry.
- `gilded-mythic-storybook` (鎏金秘境绘本): use the exact saved profile's ivory-gold radiance, cobalt structure, mulberry-plum depth, sparse jewel accents, painterly faceting, controlled ornament, and negative rules; preserve the same canonical cat identity without importing the reference's objects, symbols, architecture, pose, text, or bilateral layout.
- `cover-derived-episode-style` (封面派生/注册风格): use the episode profile's ten transferable axes. Ordinary ImageGen may use the full style envelope; Ian and every other fixed route inherit only palette, luminance, and negative space. Never import cover title/calligraphy, subject matter, symbols, scene geometry, pose, or layout.

Use the selected saved style profile only for visual language. Every white-cat prompt and QA record carries its style ID, mapped treatment, `visual_cohesion_profile_id`, selection SHA-256, and for v2 the episode profile SHA-256. Current new or modified white-cat work uses only `imagegen`; `xuan-paper-diorama` is no-cat only. Historical exact-byte-approved white-cat 宣纸 outputs remain read-only.

## Master-frame prompt contract

Use concise English fields for scene, subject, action, emotion, camera/framing, geometry, props, style, identity invariants, composition invariants, subtitle-safe area, visible-text mode, and avoid rules. Preserve culturally specific Chinese concepts bilingually when English alone could change meaning. Every white-cat prompt must include the exact marker `WHITE-CAT SATCHEL STRAP LOCK:` followed by the two strap paths, one-per-opposite-bag-end attachments, and the prohibition against using patterned himation trim as a strap.

- For `imagegen` with `white_cat_present: true` and every no-cat `xuan-paper-diorama` shot, require `visible_text_mode: none` and explicitly request no visible words, title, numeral, label, sign, interface string, signature, watermark, or accidental lettering. A `required` white-cat row or any current white-cat Xuan row is invalid and must return to `$build-video-storyboard`.
- Do not use this white-cat reference to decide text for a no-cat imagegen, Ian, Ink Doodle Knowledge Card, or Whiteboard shot. Those routes follow their own approved text contracts.

Record the Chinese source beat, final English prompt, reference version/checksum, style ID, intended beat, output path, and output checksum.

## Storyboard-image visible-text lock

Apply this lock to `imagegen` shots whose approved row has `white_cat_present: true` and to every no-cat `xuan-paper-diorama` shot. They are unconditionally text-free: keep `visible_text_mode: none`, require null exact copy and placement, and forbid narrator captions, top titles, clocks rendered as numerals, data or explanatory labels, signs, book-spine lettering, interface text, decorative lettering, signatures, watermarks, and accidental glyph-like marks. Express time, comparison, causality, values, and emphasis only through pose, expression, props, icons, color, lighting, and composition. Repeat the prohibition in every master and action-variant prompt.

Do not create a second text-approval checkpoint in visual production and never override the checksum-bound v3 row without changing the storyboard. A requested text, mode, or placement change returns to Per-Shot Visual Direction Review and then Storyboard Review before production resumes.

No-cat ordinary `imagegen`, Ian, Ink Doodle Knowledge Card, and Whiteboard shots follow their own route contracts; `xuan-paper-diorama` remains text-free with or without the cat. Ian/Ink exact text stays baked into the reviewed PNG, Whiteboard text stays bound to its approved annotation, and Remotion recreates none of them. Historical `comic-imagegen` and `doodle-slides` assets remain read-only and are never regenerated through this contract.

## Master-frame QA

Inspect full frame and thumbnail scale. Every new or explicitly rebuilt white-cat asset requires `white-cat-anatomy-qa-v2` under `leverage-video/src/shared/visual-assets/schemas/white-cat-anatomy-qa-v2.schema.json`: bind the exact reviewed source path/hash and decoded dimensions, inspect original pixels, map exactly `F1/F2/H1/H2` from shoulder/hip through continuous limb paths to four unique paws, and supply forward/reverse assignment with zero ambiguity, branch, or unassigned paw. The numbered limb map must be a different path and different bytes from the source, a complete decodable same-dimension PNG, and bind both the source SHA-256 and exact limb IDs. Run this P0 check against every final normalized white-cat 宣纸 PNG rather than inheriting pre-normalization evidence. P0 pass is required before P1 identity and the existing P2 two-strap bag geometry. Any blur, occlusion ambiguity, missing evidence, wrong contract, or extra/fused limb rejects before episode-state mutation. Existing exact-byte-approved v1 evidence remains unchanged read-only history; any revision, replacement, reapproval, or explicit rebuild requires v2.
