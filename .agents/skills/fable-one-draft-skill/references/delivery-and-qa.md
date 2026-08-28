# Delivery And QA

## Suggested Delivery Structure

```text
fable-one-draft-output/
  README.md
  topic/
    01-candidate-topics.md
    02-topic-selection-and-risk-check.md
    03-core-mechanism.md
  xiaohongshu/
    00-xiaohongshu-cover-prompt.md
    01-9-page-comic-script.md
    02-image-worker-prompt.md
    03-negative-prompt.md
    04-text-overlay-list.md
    05-publishing-copy.md
    05-publishing-copy.html
    cover/
      xiaohongshu-cover.png
    images/
      no-text/
      final-with-text/
      contact-sheet/
    image-generation-status.md
  zhihu/
    00-zhihu-cover-prompt.md
    00-zhihu-cover.png
    01-zhihu-fable-article.md
    01-zhihu-fable-article-image-insertion.html
    02-image-insertion-plan.md
    03-zhihu-topic-submission-plan.md
    03-zhihu-topic-submission-plan.html
  qa/
    01-qa-checklist.md
```

## Xiaohongshu QA

- 9 pages complete.
- 9 no-text base images actually generated when image generation is available.
- 9 final text-overlaid upload images actually generated when image generation is available.
- 6 panels per page.
- Page 9 is author note.
- Realistic scene comic style.
- No stick figures, symbols, abstract diagrams, PPT graphics, or knowledge cards.
- Image prompt and negative prompt included.
- No fake image paths if images are not generated.
- Subtitles use no-background outlined text.
- No white caption boxes or black bars.
- No large translucent backing.
- Text does not cover faces, hand actions, key objects, or panel borders.
- Delivery does not stop at no-text base images only.
- QA report distinguishes no-text base images from final text-overlaid upload images.
- Contact sheet or equivalent overview exists.
- Xiaohongshu cover image exists, or is explicitly pending when image generation is unavailable.
- If page 1 is used as the Xiaohongshu cover, it is exported or referenced separately under `xiaohongshu/cover/`.
- Xiaohongshu cover is not a contact sheet, PPT card, knowledge card, platform screenshot, or fake placeholder.
- Xiaohongshu publishing-copy HTML file actually exists.
- Images alone are not treated as a complete delivery.
- Markdown-only Xiaohongshu copy is not treated as a complete delivery.

## Required Delivery Items

- 9 no-text base images.
- 9 final text-overlaid upload images.
- Per-page image prompts.
- Negative prompt.
- Text overlay list.
- Xiaohongshu publishing copy.
- Xiaohongshu publishing-copy HTML.
- Xiaohongshu cover prompt.
- Xiaohongshu cover image, or a pending note if image generation is unavailable.
- Zhihu fable article.
- Zhihu fable article HTML image-insertion edition.
- Zhihu image insertion plan.
- Zhihu cover prompt.
- Zhihu cover image, or a pending note if image generation is unavailable.
- Zhihu topic/submission recommendation plan Markdown.
- Zhihu topic/submission recommendation plan HTML.
- Contact sheet.
- QA report.
- Image generation status report stating whether Image2 / image generation was actually called.

If image generation is unavailable, the delivery must explicitly state that images were not generated and must not include fake image paths.

## Zhihu QA

- Story-like title.
- Full fable first.
- Only one "作者的话" after the story.
- Derived from the same comic story.
- Image insertion plan provided.
- Zhihu cover image exists, or is explicitly pending when image generation is unavailable.
- Zhihu cover prompt exists.
- Zhihu cover is a standalone article cover, not a contact sheet, body screenshot, platform UI screenshot, PPT card, knowledge card, or fake placeholder.
- Zhihu HTML image-insertion edition actually exists.
- If final upload images exist, the Zhihu HTML contains 9 `<figure><img></figure>` image insertions or equivalent image blocks.
- Image insertions appear in the fable story body before "作者的话".
- Markdown-only Zhihu article is not treated as a complete delivery.
- No fake image references.
- Zhihu topic/submission recommendation plan Markdown exists.
- Zhihu topic/submission recommendation plan HTML exists.
- The recommendation HTML contains search keywords, exactly 3 topic keywords, exactly 1 submission question/direction, recommended tags/keywords, and selection reasons.
- The recommendation HTML contains "待发布时复核" when live Zhihu candidates were not actually checked.
- The recommendation HTML includes the safety boundary: no Zhihu login, no publish click, and no reading tokens, cookies, verification codes, QR codes, passwords, or browser credentials.
- The plan does not claim live Zhihu heat data unless it was actually checked.

## Complete Pass Gate

The run can be marked as a complete pass only if all of these are true:

- 9 no-text base images exist, when image generation is available.
- 9 final text-overlaid upload images exist, when image generation is available.
- Contact sheet exists.
- Xiaohongshu cover deliverable exists, or is explicitly pending because image generation is unavailable.
- Zhihu cover deliverable exists, or is explicitly pending because image generation is unavailable.
- Xiaohongshu publishing-copy HTML exists.
- Zhihu fable article HTML image-insertion edition exists.
- Zhihu topic/submission recommendation plan Markdown exists.
- Zhihu topic/submission recommendation plan HTML exists.
- QA report explicitly checks the existence of the Xiaohongshu cover, Zhihu cover, Xiaohongshu HTML, Zhihu article HTML, Zhihu recommendation Markdown, and Zhihu recommendation HTML.

If the Zhihu publishing recommendation HTML is missing, mark the delivery as incomplete even if all images, the Zhihu article HTML, and the Xiaohongshu publishing-copy HTML were generated.

If either cover is missing and there is no explicit image-generation-unavailable pending note plus cover prompt, mark the delivery as incomplete. If image generation is available, missing covers cannot pass.

If any required HTML file or the Zhihu topic/submission plan Markdown is missing, mark the delivery as incomplete even if all images were generated.

## Safety QA

- No platform publishing.
- No publish button clicking.
- No credential access.
- No tokens, cookies, verification codes, QR codes, passwords, App Secrets, private keys, or browser state.
- No private local paths or private project memory.
