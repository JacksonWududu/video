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

- Classify work before writing. Skills, shared code/tests, dependencies, tooling, `AGENTS.md`, and repository docs are maintenance; none may read, copy, or require a concrete episode workspace.
- Use `$run-knowledge-video` for complete/resumed workflows; route standalone topic, narration, storyboard, visual, and assembly work to their corresponding listed Skills.
- Route a completed episode needing a different voice while preserving locked words and visuals through `$run-knowledge-video` with `resume_mode: revoice_variant`.
- New or modified visual decisions require v3; v1/v2 are completed unchanged history only. `comic-imagegen` is historical read-only and rejected from revoice/output.
- Every episode action must resolve exactly one root-relative workspace under the workspace contract and fixed artifact categories; zero or multiple matches block.
- Run `python3 .agents/skills/run-knowledge-video/scripts/validate_episode_workspace.py <episode-workspace>` before phase work, at every phase handoff, and before completion. It must not move or delete files.

## Cross-cutting gates

- Knowledge-video gates run first. A user-named failure release advances once under `one-time-explicit-user-mechanical-gate-override-v1`. Preserve failure, bind scope/hashes/transition, consume once. Safety and permissions are excluded.

- Every ordinary boundary must carry one registered, approved, verified semantic transition decision. `scene-transition-v3` may use zero-duration `cut`; visible transitions remain 0.3–0.6 seconds. Missing, `none`, unsupported, misconfigured, renderer fallback, or unapproved decisions fail. Only the terminal clean hold is exempt.
- Before still, Studio, preview, render, or composition lock, validate transition coverage, catalog support, selection evidence, and renderer use. Otherwise provide an equivalent catalog, contract, renderer, and fail-closed validator.
- After Gate 2 choose cover-cat mode, generate 16:9/9:16/4:3 covers, then choose style before density/mode. Bind its snapshot/cohesion to v3 rows/QA. Cat work is ImageGen-only; Ian inherits palette/luminance/whitespace. Manual keeps checkpoints; one-click reapproves changed visual HTML before captions/Remotion.
- After visual lock, pass v2 automatic sound design with mandatory opening/boundary/intra-transition coverage; then before episode scripts pass shared-reuse pre-script validation, and before Remotion pass consumption validation. Legacy migration needs exact authorization and unchanged script bytes.
- Approved narration, audio, storyboard, selections, visuals, timing, captions, and delivery roles are immutable inputs. Covers are publishing-only except the approved `illustrated-flipbook` opening adapter. Missing, ambiguous, stale, unsupported, unapproved, or substituted inputs block.
- After three QA-rejected outputs for one logical storyboard image, pause its queue and require explicit user takeover; prompt/model/route/version changes never reset the count.
- After each new standard/revoice delivery transaction, call `$short-video-bgm`; final completion requires its validated recommendation. It is advisory and cannot download, mix, alter, or rerender the delivered video.
- No brand/topic opening Gate. `direct-first-shot-v1` starts S01/audio at frame 0, except the flipbook cover adapter. `OPEN-00` remains historical.
- For narrated `paper-collage-video` work, follow the project-confirmed voice provider and the provider/provenance contract in `work/paper-collage-video/skills/make-paper-collage-video/references/providers.md`; provider failure blocks and must never trigger a silent switch to another voice method.

## Verification and completion

- Follow active Skill authorities and evidence. Nonzero validation blocks unless every project-mechanical violation has one current, exact, hash-bound release recognized as `pass_with_user_override`; raw or unrecognized nonzero results block.
- Before claiming success, verify authorities exist, required tests/validators passed, checksums match disk, and no approval or ambiguity remains. Visual inspection never replaces structured validation.

## AGENTS maintenance rule

Update `AGENTS.md` only for project-wide routing, authority, permissions, gates, stops, or cross-Skill entry interfaces; keep local changes local and shared changes in their shared contract.

- Change the unique authority first, then make the smallest pointer here. Verify routing, paths, stops, and validators; keep this file at or below 6 KiB.
