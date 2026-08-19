# Local video file route v1

`local-video-file` is an explicit, never-default route for a no-cat shot. The
user selects one exact absolute local `.mp4` path during Per-Shot Visual
Direction Review. The path is part of the checksum-bound v3 review projection;
changing it reopens that row.

Do not read the file during the direction-review form. After the exact
storyboard is approved, keep every local-video item at the end of the visual
asset queue. Resolve only the selected path after all non-local generated and
Whiteboard items are explicitly approved and no review batch remains open; reject symlinks,
non-regular or empty files, and archive the exact bytes under
`assets/video/user-source/`. Require one fully decodable H.264 video stream,
native `1920×1080`, zero rotation, and a positive measured duration. Source
audio may exist but is always muted and never enters the episode mix.

Apply `local-video-match-v1`: map the complete source interval to the shot's
exact 30 fps frame count with
`playback_rate = source_duration_seconds / (target_duration_frames / 30)`.
Do not loop, trim, pad, interpolate, crop, stretch, redraw, or add text. The
Remotion `Sequence` owns the exact output frame count; the archived source bytes
remain unchanged. Record source and target durations, playback rate, media
probe/full-decode evidence, checksum, selected external path, archived asset,
and exact-byte approval.

Treat the archived source as a strict `visual-asset-review-v2` item. Present a
matched-speed preview together with the source checksum and complete locked
narration. A revoice variant may preserve the approved source bytes and
recompute only `target_duration_frames`, `target_duration_seconds`, and
`playback_rate` from the newly approved timing; every other source/media field
remains locked.
