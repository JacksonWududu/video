# Project instructions

## Scope and authority

- This file owns project routing, permissions, stops, and cross-workflow invariants.
- Keep local behavior in its Skill, shared behavior in its authority, and mechanical truth in validators.
- Nested instructions may specialize but not weaken cross-cutting gates. On conflict or stale/missing authority, stop.
- Knowledge-video state authority: `.agents/skills/run-knowledge-video/references/workflow-state-machine.md`; revoice authority: `.agents/skills/run-knowledge-video/references/revoice-variant.md`.
- Narration/audio-source, storyboard, visuals, and assembly details belong to `.agents/skills/{validate-video-narration,build-video-storyboard,produce-video-visuals,assemble-video-master}/`.
- Shared reuse and transition selection/execution belong to `leverage-video/src/shared/{reuse-registry,scene-transitions}/`; a generation route's matching recommendation rule outranks the shared semantic fallback.

## Repository-wide rules

- Before downloading a dependency or tool, seek a reusable copy. If none fits, tell the user what and why first.
- Before installing/updating a Plugin or Skill, run `$preinstall-security-review`; skip only on the user's current explicit request. Proceed only on `PASS` or enforceable `PASS WITH RESTRICTIONS`; changed candidates require review anew.
- Keep workspace-internal references root-relative. Use absolute paths only for external resources.
- Do not rewrite `work/paper-collage-video-workspace` paths unless the user requests migration.
- Run tests and validators; never accept self-reported pass fields.

## Task routing

- Before writing, classify work as `project_maintenance`, `new_video`, `resume`, or `standalone_phase`. Skills, shared infrastructure, dependencies, tooling, and repository docs are maintenance and stay in place.
- Use `$run-knowledge-video` for complete/resumed workflows; route standalone topic, narration, storyboard, visual, and assembly work to their corresponding listed Skills.
- Route a completed episode needing a different voice while preserving locked words and visuals through `$run-knowledge-video` with `resume_mode: revoice_variant`.
- New or modified visual decisions require v3; v1/v2 are completed unchanged history only. `comic-imagegen` is historical read-only and rejected from revoice/output.
- Every episode action must resolve exactly one root-relative workspace under the workspace contract and fixed artifact categories; zero or multiple matches block.
- Run `python3 .agents/skills/run-knowledge-video/scripts/validate_episode_workspace.py <episode-workspace>` before phase work, at every phase handoff, and before completion. It must not move or delete files.

## Cross-cutting gates

- Every ordinary boundary must carry one registered, approved, verified semantic transition decision. `scene-transition-v3` may use zero-duration `cut`; visible transitions remain 0.3–0.6 seconds. Missing, `none`, unsupported, misconfigured, renderer fallback, or unapproved decisions fail. Only the opening hard cut and terminal clean hold are exemptions.
- Before still, Studio, preview, render, or composition lock, validate transition coverage, catalog support, selection evidence, and renderer use. Otherwise provide an equivalent catalog, contract, renderer, and fail-closed validator.
- After Gate 2 choose one white-cat style (`loose-line-vivid-watercolor` or `twilight-neon-animation`) before density/mode. Bind its SHA/cohesion to every v3 row and visual QA; current cat work is ImageGen-only. Ian keeps its sole Style Anchor/medium and inherits only palette, luminance, and whitespace. Manual keeps checkpoints. One-click reapproves current full-visual HTML after any image change, then chooses captions before Remotion.
- Before episode scripts, pass shared-reuse pre-script validation; before protected Remotion actions, pass consumption validation with real consumer evidence. Legacy migration needs exact authorization and unchanged script bytes.
- Approved narration, audio, storyboard, selections, images, timing, cover, caption mode, and delivery roles are immutable contract inputs. Missing, ambiguous, stale, unsupported, unapproved, or substituted inputs block work.
- After three QA-rejected outputs for one logical storyboard image, pause its queue and require explicit user takeover; prompt/model/route/version changes never reset the count.
- After each new standard/revoice delivery transaction, call `$short-video-bgm`; final completion requires its validated recommendation. It is advisory and cannot download, mix, alter, or rerender the delivered video.
- No opening brand/topic Gate. Preserve exact first sentence/end frame and `OPEN-00 -> S01`; authorities govern downstream delivery.
- For narrated `paper-collage-video` work, confirm the requested Voicebox profile, synthesize every segment with Voicebox MCP, record every `generation_id`, retrieve the matching WAV files, convert them deterministically, measure real durations, update timing and subtitles, and only then render. If Voicebox MCP or the requested profile is unavailable, stop; never fall back to Edge TTS, macOS `say`, or another provider.

## Verification and completion

- Follow the active Skill's references, schemas, commands, and approval evidence. Any nonzero validator blocks downstream work and completion.
- Before claiming success, verify authorities exist, required tests/validators passed, checksums match disk, and no approval or ambiguity remains. Visual inspection never replaces structured validation.

## AGENTS maintenance rule

Update `AGENTS.md` only for project-wide routing, authority, permissions, gates, stops, or cross-Skill entry interfaces; keep local changes local and shared changes in their shared contract.

- Change the unique authority first, then make the smallest pointer here. Verify routing, paths, stops, and validators; keep this file at or below 6 KiB.
