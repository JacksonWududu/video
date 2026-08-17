# Upstream provenance

- Source: `https://github.com/geeklee/srt-whiteboard-animation`
- Pinned commit: `696a7243c0e6ffb6827676e539c2ca5ebae2bf6b`
- Commit date: `2026-07-28T00:22:11+08:00`
- Downloaded archive SHA-256: `438bc7fe9f81415f572b249d33636a5c015e889453d792a92e3dc236dd78ab45`
- License: MIT; preserved verbatim at `LICENSE`.

Retained upstream files before local adaptation:

- `assets/drawing-hand.png`: `978ee3ca979e0bf3f0b6187926828c30464adafbb0a6bbb61c9dbe327d3bfd61`
- `scripts/stream_render.py`: `6544d58593642eb9e7056170212dc22ed88b652f5fb7666830b58c8114c5fad0`
- `scripts/render_stream_whiteboard.py`: `a476483d5fcd149f685e61963573f081e11e6aff0517f916c44929504534079e`; vendored as `scripts/region_stream_renderer.py`.

Not retained: upstream SRT parser, scene merger, browser editor, automatic environment installer, README, examples, and example media. Local scripts enforce the project's frame, approval, path, media, and dependency contracts.
