# Ian knowledge-video frame adapter

Use `ian-knowledge-video-frame-v1` only when an approved knowledge-video shot
selects `visual_generation_route: ian-handdrawn-ppt`. This mode overrides the
ordinary article/PPT page shell; it does not create a deck.

## Bound input

Before generation, require one resolved episode workspace, one queue item and
shot ID, and the current `per-shot-visual-direction-review-v3` artifact path,
file SHA-256, and `presented_map_sha256`. The selected row must be approved and
must match the shot, route, `treatment_profile_id`, `visible_text_mode`, exact
Chinese, and placement byte-for-byte. Missing, stale, ambiguous, or mismatched
evidence blocks generation.

## Prompt override

- Produce exactly one final 1920×1080 PNG for the queue item. Do not expand the
  shot into a deck, alternate page, cover, or multi-page set.
- Reuse Ian's near-white paper, fine handdrawn lines, restrained pastel palette,
  diagram grammar, and negative space. Disable the ordinary page shell: no
  automatic page number, title, subtitle, label, signature, watermark, corner
  text, or filler writing.
- For `visible_text_mode: none`, use an empty `Required text only` list and keep
  every prop blank or line-only. The final raster must contain no visible text.
- For `visible_text_mode: required`, list only the exact v3-approved Chinese.
  Do not add a page number, title, subtitle, heading, explanation, English,
  signature, or inferred label. Deterministic text repair may place only those
  exact bytes at the approved placement.
- A contact sheet is an outer Visual Asset Review artifact only. Never bake it,
  its filename, numbering, border, or annotations into the shot raster.

## Output and validation

Write one `ian-knowledge-video-frame-v1` manifest beside the versioned review
evidence. Its repository-root-relative paths bind the exact review and output
raster, and every path must remain inside the resolved episode workspace.
Run:

```bash
python3 .agents/skills/ian-handdrawn-ppt/scripts/validate_knowledge_video_frame.py \
  --episode-workspace <episode-workspace> \
  <ian-knowledge-video-frame-v1.json>
```

The validator rereads the review and PNG from disk, checks both SHA-256 values,
requires one 1920×1080 final raster, rejects every automatic page-shell field,
and compares the verified visible-text list with the approved v3 row. Visual
inspection and Visual Asset Review remain required; the manifest cannot approve
its own pixels.
