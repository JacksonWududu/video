# Visual language provenance

The catalog adapts planning ideas from `baoyu-article-illustrator`, `baoyu-comic`,
`baoyu-infographic`, `baoyu-slide-deck`, and `baoyu-xhs-images` at Baoyu Skills
commit `6b7a2e417500561a5ecdd0b168332f4142584617` (MIT).

- Source: <https://github.com/JimLiu/baoyu-skills/tree/6b7a2e417500561a5ecdd0b168332f4142584617>
- License: <https://github.com/JimLiu/baoyu-skills/blob/6b7a2e417500561a5ecdd0b168332f4142584617/LICENSE>
- Adaptation: taxonomy, compatibility, density, the upstream style × layout
  matrix mapped onto internal treatment profiles, and comic-planning rules only.
- Omitted: upstream runtime, batch generation, external image backends, Bun scripts,
  PDF assembly, vertical/XHS cards, watermarks, CTAs, publishing, fetching, and translation.
- Deferred: `baoyu-diagram` as an independent safe-SVG-to-approved-PNG route.

All Comic production images remain 1920×1080 PNGs generated through Codex
native `imagegen` and enter the existing sequential asset-review gate. Existing
Ian, Ink Doodle Knowledge Card, and Whiteboard production routes retain their
own generators and approval evidence. The former `doodle-slides` route is
historical read-only.
