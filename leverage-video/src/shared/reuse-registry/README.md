# Shared reuse registry

Before creating or copying episode script code:

1. Read `registry.json` and inspect each registered path.
2. Before script work, run `node leverage-video/src/shared/reuse-registry/create-reuse-decision.mjs <episode-workspace>`.
3. Fill every generated decision with `reuse`, `extend_shared`, or `not_applicable` plus a concrete reason.
4. Run `node leverage-video/src/shared/reuse-registry/validate-reuse-decision.mjs <decision.json> --phase pre-script`.
5. Reuse or extend shared code before adding episode-local bindings.
6. Add consumer source/checksum and real import-marker evidence to every `reuse` or `extend_shared` row.
7. Run the same validator with `--phase consumption` before any Remotion still, Studio, preview, render, or composition lock.
8. Run shared and episode tests as real commands; JSON fields never substitute for executed tests.

Episode-local wrappers may bind paths, assets, and composition IDs. Shared behavior, validators, renderers, file-integrity logic, transition logic, and QA utilities must not be copied into an episode.

## Authorized legacy migration

Use this only when an episode script directory predates this gate and the user gives explicit user authorization for that exact episode. Run `create-legacy-reuse-decision.mjs` with the exact authorization message and time, fill every decision, and require `--phase legacy-migration` before adding new bindings. The manifest records the complete existing script inventory and checksums; do not move or clear scripts and do not write an empty `pre_script_inventory`. After migration, list every new binding in `legacy_additions`, record real consumer imports, and require `--phase consumption`. Any changed or missing baseline script blocks rendering.
