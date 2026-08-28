# Workflow

## Topic

If the user provides a topic, validate it. If the topic is blank, generate 10 low-risk candidate short topics and choose the best one automatically.

Good topics are short Chinese terms, usually 2-8 characters, preferably 4-5 characters. They should represent a concept, phenomenon, platform slang, industry term, or common phrase.

Avoid political, disaster, criminal, privacy, minor-related, medical, financial, and legal high-risk topics.

## Steps

1. Candidate short topic table.
2. Auto-selected topic and reason.
3. Risk and suitability check.
4. Core mechanism.
5. Three comic story directions.
6. Auto-select the best direction.
7. Xiaohongshu 9-page comic script.
8. Image prompts and negative prompts.
9. If Image2 / image generation is available, call the image tool directly and generate 9 no-text base images.
10. Add Chinese text overlays and produce 9 final upload images. Do not stop at no-text base images.
11. Create or derive Xiaohongshu and Zhihu cover deliverables.
12. Text overlay instructions.
13. Xiaohongshu publishing copy in Markdown and standalone HTML.
14. Zhihu fable article in Markdown and HTML image-insertion edition.
15. Zhihu image insertion plan.
16. Zhihu publishing recommendation pack in Markdown and standalone HTML.
17. Delivery structure.
18. QA checklist that verifies required cover files, HTML files, and Zhihu publishing recommendation files actually exist.

## Comic Structure

- 9 pages.
- 6 panels per page.
- Pages 1-8 tell the complete story.
- Page 9 is the author note page.
- The story should use concrete people, scenes, objects, and actions instead of abstract explanation.
- Each page must include 6 panel actions, per-panel overlay text, a page-level summary subtitle, character actions, expressions, key objects, and scene changes.
- Page 9 is still a six-panel life-scene comic page, not a pure knowledge card.
- When image generation is available, image prompts are not the final output. The workflow must actually produce both no-text base images and final text-overlaid upload images.

## Zhihu Structure

Zhihu article must be derived from the comic story. Use a story-like title. Tell the complete fable first. Do not insert explanatory headings in the middle of the story. After the story, add one section called "作者的话" to explain the concept, mechanism, boundary, and reader reminder.

## Publishing File Rule

The workflow cannot be marked complete with images only or Markdown only.

The final delivery must include:

- A standalone Xiaohongshu publishing-copy HTML file.
- A Zhihu fable article HTML image-insertion edition.

If final Xiaohongshu upload images exist, the Zhihu HTML image-insertion edition must insert all 9 comic images in the story body before "作者的话" using `<figure><img></figure>` or an equivalent HTML structure. If images were not generated, the Zhihu HTML must be clearly marked as pending image backfill and include an insertion plan instead of fake image paths.

## Cover Rule

The workflow must output cover deliverables, not only story pages.

Xiaohongshu cover:

- The first final upload image may be used as the Xiaohongshu cover only if page 1 is intentionally designed as a cover-ready story opening with a clear title hook, visible topic emotion, and readable overlay text.
- Even when page 1 is used as the cover, export or reference it separately as `xiaohongshu/cover/xiaohongshu-cover.*` so the user can find it quickly.
- If page 1 is not cover-ready, create a separate Xiaohongshu cover from the same story world and include the prompt/source note.

Zhihu cover:

- Output a standalone Zhihu cover image, preferably 1200x675 or another suitable article-cover ratio.
- The Zhihu cover should use the same realistic low-saturation watercolor story world, with a title or visual hook suitable for an article entry.
- Do not use a contact sheet, platform UI screenshot, PPT card, knowledge card, or raw body image renamed as a cover.
- If image generation is unavailable, output a dedicated Zhihu cover prompt and mark the cover image as pending.

## Zhihu Publishing Recommendation Rule

Before the final QA, output a Zhihu publishing recommendation pack in both Markdown and standalone HTML. It is not platform publishing and must not click any publish button.

Both the Markdown and HTML versions must contain:

- Search keywords: topic term, title keywords, mechanism keywords, and 1-3 body keywords.
- Exactly 3 recommended topic keywords that the user can type into Zhihu topic selection.
- Exactly 1 recommended submission question/direction for `投稿至问题` or, if no suitable question is available, a clear recommendation to use topic selection instead.
- Reasons based on article mechanism, relevance, risk boundary, and expected reader intent.
- Recommended tags/keywords for manual pre-publish checking.
- A "待发布时复核" mark when live Zhihu candidates were not actually checked.
- Safety boundary: do not log in to Zhihu, do not click publish, and do not read tokens, cookies, verification codes, QR codes, passwords, or browser credentials.

If live Zhihu browsing is unavailable, infer conservatively from the article mechanism and clearly mark the recommendation as "待发布时复核". Do not invent heat numbers.

The standalone HTML exists to help the user manually check Zhihu upload options before publishing. If the Zhihu publishing recommendation HTML is missing, the delivery is incomplete even if all images, Xiaohongshu HTML, and Zhihu article HTML were generated.
