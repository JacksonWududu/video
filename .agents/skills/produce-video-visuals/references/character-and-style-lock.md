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
- Aegean-blue satchel on the anatomical right flank, with the strap running from anatomical left shoulder to right flank;
- when the camera exposes the character's front, keep that strap visibly routed across the front of the lower neck/upper chest from anatomical left shoulder toward the right-flank satchel; do not hide it behind the neck or turn it into a separate collar loop;
- centered aged-bronze olive-leaf clasp, blank papyrus in the right-side pocket, small aged-bronze owl charm near the anatomical left chest, and ivory-cobalt collar.

Keep the satchel visible in every cat shot unless it is physically occluded by the approved camera or pose. Perspective may hide an accessory, but never relocate it to the wrong side merely to keep it visible. Do not change the himation, satchel, strap direction, clasp, papyrus, owl charm, collar, eye circles, beard, eyes, fur, or tail, or introduce extra characters unless the user explicitly requests a new identity version. Pose, expression, gaze, camera view, and scene may vary while identity remains locked.

Label the sheet as `identity/composition reference`, never as a multi-cat layout source.

## Locked style

For ordinary `imagegen`, use style ID `loose-line-vivid-watercolor` (松线明彩水彩) on a landscape canvas targeting 16:9 within `0.5%` relative aspect-ratio error; exact 1920×1080 is required for the later composition derivative:

- warm off-white cold-press paper;
- transparent luminous watercolor washes;
- irregular brushed edges and exposed paper;
- sparse loose broken black-brown charcoal/dry-ink contours.

Use the saved style profile only for visual language. Prevent the style or identity reference from leaking old scene geometry, pose-sheet layouts, text, or unrelated props.

For `xuan-paper-diorama`, this watercolor profile is replaced—not blended—with the checksum-pinned `$generate-visual-styles` profile. Preserve the same canonical cat identity while rendering four-to-seven 宣纸 depth planes, visible paper fibers/cut/fold edges, warm paper neutrals, restrained mineral accents, miniature tabletop lighting, and no visible text. Do not transfer the canonical reference's watercolor background or pose-sheet layout.

## Master-frame prompt contract

Use concise English fields for scene, subject, action, emotion, camera/framing, geometry, props, style, identity invariants, composition invariants, subtitle-safe area, visible-text mode, and avoid rules. Preserve culturally specific Chinese concepts bilingually when English alone could change meaning.

- For ordinary `imagegen` with `white_cat_present: true` and every `xuan-paper-diorama` shot, require `visible_text_mode: none` and explicitly request no visible words, title, numeral, label, sign, interface string, signature, watermark, or accidental lettering. A `required` row is invalid and must return to `$build-video-storyboard`.
- Do not use this white-cat reference to decide text for a no-cat imagegen, Ian, Ink Doodle Knowledge Card, or Whiteboard shot. Those routes follow their own approved text contracts.

Record the Chinese source beat, final English prompt, reference version/checksum, style ID, intended beat, output path, and output checksum.

## Storyboard-image visible-text lock

Apply this lock to ordinary `imagegen` shots whose approved row has `white_cat_present: true` and to every `xuan-paper-diorama` shot. They are unconditionally text-free: keep `visible_text_mode: none`, require null exact copy and placement, and forbid narrator captions, top titles, clocks rendered as numerals, data or explanatory labels, signs, book-spine lettering, interface text, decorative lettering, signatures, watermarks, and accidental glyph-like marks. Express time, comparison, causality, values, and emphasis only through pose, expression, props, icons, color, lighting, and composition. Repeat the prohibition in every master and action-variant prompt.

Do not create a second text-approval checkpoint in visual production and never override the checksum-bound v3 row without changing the storyboard. A requested text, mode, or placement change returns to Per-Shot Visual Direction Review and then Storyboard Review before production resumes.

No-cat ordinary `imagegen`, Ian, Ink Doodle Knowledge Card, and Whiteboard shots follow their own route contracts; `xuan-paper-diorama` remains text-free with or without the cat. Ian/Ink exact text stays baked into the reviewed PNG, Whiteboard text stays bound to its approved annotation, and Remotion recreates none of them. Historical `comic-imagegen` and `doodle-slides` assets remain read-only and are never regenerated through this contract.

## Master-frame QA

Inspect full frame and thumbnail scale. Count limb categories separately before the total: require exactly two forelegs, then exactly two hindlegs, then exactly four paws. When one forepaw is raised, allow exactly one other forepaw on the ground; the two remaining grounded paws must connect unambiguously to the two hindlegs. A third foreleg or third forepaw is an automatic rejection, even if the total silhouette initially looks plausible. Reject face/body drift, wrong eyes or eye circles, missing/wrong beard, tail-pattern drift, reversed strap, relocated/wrong satchel, missing or duplicated accessory without valid physical occlusion, unapproved clothing, extra characters, malformed anatomy, portrait orientation or more than `0.5%` relative error from 16:9, unsafe subtitle composition, or style mismatch. For ordinary white-cat `imagegen`, reject every visible word, numeral, label, sign, interface string, signature, watermark, top title, or accidental glyph-like mark without exception. Never stretch or pad a source to pass. Correct one targeted issue at a time from the valid source.
