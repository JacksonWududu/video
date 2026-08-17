# Project instructions

## Scope and authority

- This file owns project routing, permissions, stops, and cross-workflow invariants, not manuals or changelogs.
- Keep local behavior in its Skill, shared behavior in its orchestrator/reference, and mechanical truth in schemas/validators.
- Nested instructions may specialize but not weaken cross-cutting gates. On conflict or stale/missing authority, stop.
- Knowledge-video state authority: `.agents/skills/run-knowledge-video/references/workflow-state-machine.md`; revoice authority: `.agents/skills/run-knowledge-video/references/revoice-variant.md`.
- Narration, storyboard, visuals, and assembly details belong to `.agents/skills/{validate-video-narration,build-video-storyboard,produce-video-visuals,assemble-video-master}/`.
- Shared reuse and transition selection/execution belong to `leverage-video/src/shared/{reuse-registry,scene-transitions}/`; a generation route's matching recommendation rule outranks the shared semantic fallback.

## Repository-wide rules

- Before downloading a dependency or tool, seek a reusable copy. If none fits, tell the user what and why first.
- Before installing/updating a Plugin or Skill, run `$preinstall-security-review`; skip only on the user's current explicit request. Proceed only on `PASS` or enforceable `PASS WITH RESTRICTIONS`; changed candidates require review anew.
- Keep workspace-internal references root-relative. Use absolute paths only for external resources.
- Do not rewrite paths inside `work/paper-collage-video-workspace`; it is an excluded machine-local workspace unless the user explicitly requests migration.
- Run tests and validators as real commands. Never accept a self-reported pass field as evidence.

## Task routing

- Before writing, classify work as `project_maintenance`, `new_video`, `resume`, or `standalone_phase`. Skills, shared infrastructure, dependencies, tooling, and repository docs are maintenance and stay in place.
- Use `$run-knowledge-video` for complete/resumed workflows; route standalone topic, narration, storyboard, visual, and assembly work to their corresponding listed Skills.
- Route a completed episode needing a different voice while preserving locked words and visuals through `$run-knowledge-video` with `resume_mode: revoice_variant`.
- New or modified visual decisions require v3; v1/v2 are completed unchanged history only. `comic-imagegen` is historical read-only and rejected from revoice/output.
- Every episode action must read the workspace contract, resolve exactly one root-relative episode workspace, pass it to every Skill/tool, and use fixed artifact categories. Zero or multiple standalone matches block work.
- Run `python3 .agents/skills/run-knowledge-video/scripts/validate_episode_workspace.py <episode-workspace>` before phase work, at every phase handoff, and before completion. It must not move or delete files.

## Cross-cutting gates

- Every ordinary boundary must carry one registered, approved, verified semantic transition decision. `scene-transition-v3` may use zero-duration `cut`; visible transitions remain 0.3–0.6 seconds. Missing, `none`, unsupported, misconfigured, renderer fallback, or unapproved decisions fail. Only the opening hard cut and terminal clean hold are exemptions.
- Before still, Studio, preview, render, or composition lock, validate transition coverage, catalog support, selection evidence, and renderer use. Otherwise provide an equivalent catalog, contract, renderer, and fail-closed validator.
- Preserve knowledge-video phase order and every checkpoint: Gate 1, Gate 2, Per-Shot Visual Direction Review, Per-Boundary Transition Review, Storyboard Review, Visual Asset Review, and final Caption Delivery Choice. Never infer pending choices from `默认`, `继续`, `你看着办`, general authorization, or another review.
- Before episode scripts, require shared-reuse pre-script validation. Before protected Remotion actions, require real consumer evidence and consumption validation. Legacy migration needs exact user authorization and unchanged baseline script bytes.
- Approved narration, audio, storyboard, selections, images, timing, cover, caption mode, and delivery roles are immutable contract inputs. Missing, ambiguous, stale, unsupported, unapproved, or substituted inputs block work.
- Workflow authorities define opening, transitions, captions, BGM, browser, opening QA, and delivery. Preserve `OPEN-00 -> S01`; deliver only selected full-master roles.
- For narrated `paper-collage-video` work, confirm the requested Voicebox profile, synthesize every segment with Voicebox MCP, record every `generation_id`, retrieve the matching WAV files, convert them deterministically, measure real durations, update timing and subtitles, and only then render. If Voicebox MCP or the requested profile is unavailable, stop; never fall back to Edge TTS, macOS `say`, or another provider.

## Verification and completion

- Follow the active Skill's references, schemas, commands, and approval evidence. Any nonzero validator blocks downstream work and completion.
- Before claiming success, verify authorities exist, required tests/validators passed, checksums match disk, and no approval or ambiguity remains. Visual inspection never replaces structured validation.

## AGENTS maintenance rule

Skill changes do not automatically require an `AGENTS.md` update. Update this file only when project-wide scope, task routing, authority locations, permissions, approval gates, stop conditions, or cross-workflow invariants change.

- Skill-local changes update only that Skill; cross-Skill workflow changes update its shared contract; project-wide changes update this file.
- Update only for Skill/trigger routing, project gates, authority moves, stale summaries, or cross-Skill interfaces affecting entry—not internal details, behavior-preserving fixes, unchanged validator contracts, or local tests.
- Change the unique authority first, then make the smallest pointer/gate edit here. Verify routing, paths, stops, and validators; keep this file at or below 6 KiB without duplicated detail.
