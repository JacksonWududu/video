# Image Rules

## Visual Style

Use Chinese realistic low-saturation watercolor comic style. The scene should feel like documentary life photos transformed into watercolor comics.

Requirements:

- Real adults.
- Real Chinese daily-life environments.
- Natural expressions and actions.
- Soft natural light.
- Paper grain.
- Thin black panel dividers.
- Restrained and story-driven.

Avoid:

- Stick figures.
- Symbol people.
- Abstract diagrams.
- Q-style cartoon mascots.
- PPT graphics.
- Knowledge cards.
- Posters.
- Platform UI.
- Brand logos.
- Garbled Chinese text.

## Real Image Generation Priority

If an actual image generation tool is available, use it to generate real scene comic images. Do not only write prompts. If no image generation tool is available, say so clearly and provide complete image worker prompts.

Do not use local scripts, SVG, ASCII art, geometric drawing, or placeholders as final images.

## Image2 Direct Generation

When Image2 / image generation is available, do not stop at prompts.

Stage 1: generate no-text base images.

- One image per page, 9 pages total.
- 1024x1536 portrait target.
- 2 columns x 3 rows, 6 panels per page.
- No Chinese text, no watermark, no caption boxes, no empty speech bubbles.
- Clear story action in every page.
- Real character movement, expressions, key objects, and scene changes.

Stage 2: create final text-overlaid upload images.

- Add Chinese narration, dialogue, or author-note text after base image generation.
- Use no-background outlined text.
- Do not use white boxes, black bars, or large translucent backings.
- Do not add watermarks, signatures, promotional identifiers, QR codes, social-media handles, or contact details.
- Output 9 final upload images.
- Final delivery is not complete until all 9 final upload images exist.

Only if image generation is unavailable should the skill output image worker prompts instead.

Local scripts may only do:

- Text overlay.
- Crop.
- Size check.
- Contact sheet.

Local scripts must not draw people, main scenes, or key objects.

## Cover Images

Cover images are required delivery items.

Xiaohongshu cover:

- Page 1 may serve as the Xiaohongshu cover only when it is intentionally cover-ready: clear title hook, readable overlay, strong story opening, and no clutter.
- Even if page 1 is used, export or reference it separately as a cover file under `xiaohongshu/cover/`.
- If page 1 is not cover-ready, generate or derive a separate Xiaohongshu cover from the same story world.
- Do not count the contact sheet as a cover.

Zhihu cover:

- Create a standalone article cover image, preferably 1200x675 or another suitable Zhihu article-cover ratio.
- Use the same realistic Chinese daily-life watercolor world and the same core story object or scene.
- Add any Chinese title text in a post-processing/text-overlay stage when possible; do not rely on Image2 to render small Chinese text directly.
- Do not use platform UI, logo, screenshot, contact sheet, PPT card, knowledge card, or placeholder graphics as the cover.

## Subtitle Style

Default subtitle style is no-background outlined text:

- No white rectangular caption box.
- No black subtitle bar.
- No large translucent backing.
- Use light text with dark outline and subtle shadow.
- Put text in empty scene areas.
- Do not cover faces, hand actions, key objects, or panel borders.
- Keep each panel short, ideally 8-14 Chinese characters and 1-2 lines.

Each final upload page must use the corresponding no-text base image as visual source. Do not make final pages from SVG, ASCII, script drawings, PPT graphics, knowledge cards, or placeholders.

## Image Cleanliness Rule

Keep both no-text base images and final upload images free of watermarks, signatures, promotional identifiers, QR codes, social-media handles, and contact details.

## If Images Are Not Generated

Do not pretend image files exist. Provide:

1. Full image worker prompt.
2. Negative prompt.
3. Text overlay list.
4. QA checklist.
5. Clear statement that images were not generated in the current environment.

If Image2 output is not a six-panel comic page, not a realistic life scene, has severely broken characters, contains garbled text, or repeatedly fails QA, regenerate the affected page. If repeated regeneration still fails, record the failure in QA and do not pass low-quality images as final output.
