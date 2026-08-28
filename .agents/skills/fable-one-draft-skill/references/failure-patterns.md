# Failure Patterns

## Stops At Topic Selection

Problem: The agent lists candidates and asks the user to choose.

Fix: Candidate topics are records, not pause points. Choose Top 1 automatically and continue.

## Turns Into Knowledge Cards

Problem: The comic becomes PPT, cards, posters, or abstract concept slides.

Fix: Use concrete characters, scenes, objects, and actions. Every panel should show something happening in a real place.

## Uses Script Placeholder Images

Problem: Local drawing scripts create geometric people or abstract scenes.

Fix: Do not use placeholder images as final images. Use image generation tools for base images or output image worker prompts.

## White Caption Boxes Or Black Bars

Problem: Subtitles appear as white blocks, black bars, or large translucent panels.

Fix: Use no-background outlined text with subtle shadow.

## Zhihu Becomes An Essay

Problem: The article starts with definitions and explanatory headings.

Fix: Tell the complete fable first, then add one "作者的话".

## Pretends Images Exist

Problem: The output references image paths even though no images were generated.

Fix: If images were not generated, output an insertion plan and state that images are pending.

## Has Image2 But Only Outputs Prompts

Problem: The current Codex environment has image generation, but the agent only writes image prompts.

Fix: Call Image2 / image generation directly. Generate 9 no-text base pages first, then create 9 final text-overlaid upload pages.

## Stops At No-Text Base Images

Problem: The agent generates base images but never adds Chinese narration, dialogue, or author-note text.

Fix: Final Xiaohongshu delivery requires both base images and text-overlaid upload images. No-text base images alone are not complete.

## Text Overlay Looks Like Caption Blocks

Problem: Final images contain white caption boxes, black subtitle bars, large translucent backings, or text covering faces, hands, or key objects.

Fix: Use no-background outlined text with subtle shadow. Keep text short, ideally 8-14 Chinese characters and 1-2 lines, and place it in empty scene areas.

## Page 9 Turns Into A Knowledge Card

Problem: The author-note page becomes a poster, PPT, quote card, or pure text page.

Fix: Page 9 must still be a six-panel life-scene comic page. It can explain the mechanism, but each panel still needs a concrete scene, object, action, and overlay text.

## Leaks Private Context

Problem: The output references local paths, private documents, private memory, or account environment.

Fix: Treat the user as an external user and rely only on the provided public skill.

## Images Complete But Publishing Files Missing

Problem: The image chain succeeds, but the delivery contains no Xiaohongshu publishing-copy HTML or no Zhihu HTML image-insertion edition.

Fix: The workflow is incomplete. Generate the missing HTML files and update QA to verify their actual existence. Images alone cannot pass the complete delivery gate.

## Markdown Only Delivery

Problem: The agent writes Xiaohongshu copy or Zhihu article only as Markdown and marks the run complete.

Fix: Markdown is only a backup/readable source. Complete delivery requires standalone Xiaohongshu HTML and Zhihu fable HTML image-insertion edition.

## Missing Zhihu Topic Or Submission Recommendation

Problem: The run produces the Zhihu article but omits the publishing-side recommendation: search keywords, topics, and submission direction.

Fix: Add a Zhihu topic/submission plan with search keywords, exactly 3 recommended topic keywords, exactly 1 submission question/direction, and reasons. If live Zhihu browsing is unavailable, mark it as pending final verification instead of inventing heat data.

## Missing Covers

Problem: The run produces story images and articles but no Xiaohongshu cover or Zhihu cover.

Fix: Covers are required delivery items. Export or reference a cover-ready page 1 as `xiaohongshu/cover/xiaohongshu-cover.*`, or create a separate Xiaohongshu cover. Also create a standalone Zhihu article cover, preferably 1200x675. If image generation is unavailable, output dedicated cover prompts and mark cover images as pending instead of pretending they exist.
