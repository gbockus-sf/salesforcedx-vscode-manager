# Build tracking — salesforcedx-vscode-manager

A running ledger of AI-assisted work: **tokens used** per task, **lines of code**
generated/deleted, and any notes worth remembering. Update the "Summary" block
at the bottom whenever a row is added.

> **How to read the LoC columns.** Numbers are `git log --numstat` sums across
> all commits belonging to a task, **excluding `package-lock.json`** (which
> dominates Phase 1 otherwise). `net = added − deleted`.
>
> **How to read the Tokens column.** Only the Phase 6 subagent reported its
> own token usage directly (73,214 via the task-notification). Main-session
> phases show `—` here; fill them in from your harness telemetry / transcript
> inspection when available.

## Per-task ledger

| Task | Duration | Commits | LoC added | LoC deleted | Net | Tokens | Notes |
|---|---|---|---|---|---|---|---|
| **Planning** (explore IDEx + AFV, design, incorporate VSIX + status-bar + tracker idea) | ~35 min | 1 (initial `PLAN.md`) | 448 | 0 | 448 | — | Three parallel Explore agents; one Plan agent; four rounds of AskUserQuestion. |
| **Phase 0 — Bootstrap** | ~5 min | 2 | 452 | 4 | 448 | — | `.gitignore`, `LICENSE`, `CHANGELOG`, `README`, `PLAN.md`. gpg passphrase blocker resolved by user. |
| **Phase 1 — Build & test scaffolding** | ~4 min | 1 | 656 | 28 | 628 | — | `package.json`, `tsconfig.json`, `esbuild.js`, `jest.config.js`, `eslint.config.mjs`, CI workflow, vscode mock, first passing test. |
| **Phase 2 — Activation skeleton** | ~6 min | 2 (incl. icon fix) | 424 | 17 | 407 | — | Logger, four empty service wrappers, activity-bar container, two placeholder tree views. Icon SVG had to be rewritten (stroke → filled paths). |
| **Phase 3 — Extension service** | ~5 min | 1 | 264 | 7 | 257 | — | `managed()` / `isInstalled()` / `isEnabled()` / `readManifest()` / `enable` / `disable` / `install` / `uninstall`. 12 unit tests. |
| **Phase 4 — Groups model** | ~4 min | 1 | 348 | 4 | 344 | — | Built-in Apex/Lightning/React-stub, merge-store, applier. 15 unit tests. |
| **Phase 5 — Group commands + tree view** (+ enablement debugging + code-CLI pivot) | ~35 min | 4 (feat, icon/toast fix, diag logging, code-CLI pivot) | 519 | 82 | 437 | — | Initial implementation used `workbench.extensions.action.*` commands that don't exist in current VSCode → pivoted to `code --install/--uninstall` as the apply mechanism. Big design shift; captured as a backend setting. |
| **Phase 6 — Dependency engine** | ~5 min of main + ~5 min of subagent | 2 (subagent commit + merge) | 794 | 7 | 787 | **73,214** (subagent) | Ran in a sibling git worktree via background subagent; subagent could not commit due to sandbox, main session committed and merged. 65 new tests. |
| **Phase 7 — Dependency commands + tree view** | ~5 min | 1 | 383 | 23 | 360 | — | Category grouping, status icons with ThemeColor, markdown report formatter. 7 unit tests. |
| **Phase 8 — VSIX override** | ~10 min | 1 | 555 | 22 | 533 | — | Scanner (filename parser + FS watcher), installer (`--force`, provenance tracking), 4 commands, groups-tree badges. 11 unit tests. |
| **Phase 9 — Status bar** | ~6 min | 1 | 245 | 8 | 237 | — | Two left-aligned items with warning background when VSIX active; wires through `onAfterApply` callback. 7 unit tests. |
| **Phase 10 — Polish** | ~15 min | 1 | 322 | 20 | 302 | — | Walkthrough (4 steps), README rewrite, CHANGELOG, VSIX packaging (`dist/` output + `.vscodeignore` tuning). Clean 12-file 22 KB `.vsix`. |
| **Docs / TODOs follow-ups** | — | 3 | 74 | 0 | 74 | — | `PLAN.md` §9 TODOs (topological uninstall, id-dedup, installed-version/update indicators, etc.). |
| **Docs: TRACKING + CONTRIBUTING + CLAUDE** | ~15 min | 2 | 285 | 3 | 282 | — | `TRACKING.md` effort ledger, `CONTRIBUTING.md` worktree/gpg recipe, `CLAUDE.md` agent directions. Ran in parallel with two backgrounded subagents. |
| **Feature: Dependencies tree dedup by fingerprint** | ~5 min setup + ~5 min subagent | 2 (subagent commit + merge) | 321 | 24 | 297 | **75,771** (subagent) | Backgrounded subagent in `feat/deps-dedup-fingerprint` worktree. Sandbox blocked the subagent's `git commit`; main session committed in the worktree and merged. Added fingerprint-based folding (built-in > shim > manifest precedence); tooltip lists multiple owners. 93 → 100 tests. |
| **Feature: Groups tree version + update indicators** | ~5 min setup + ~10 min subagent + ~3 min merge | 2 (subagent commit + merge w/ conflict resolution) | ~850 | ~50 | ~800 | **132,302** (subagent) | Backgrounded subagent in `feat/groups-version-indicators` worktree, ran concurrently with the dedup subagent. Same sandbox-blocks-commit pattern; main session committed + merged. Added `MarketplaceVersionService` (1h-cached probe), `ExtensionService.getNodeVersionInfo`, three new commands, one new setting. PLAN.md had a real merge conflict (both branches edited the same TODO block) resolved by keeping both checkboxes. 100 → 124 tests. |
| **Cleanups batch (7 §9 TODOs)** | ~30 min foreground | 1 | 280 | 60 | 220 | — | Two backgrounded subagents died on Bash-permission denial before writing any files (harder sandbox than prior rounds). Pivoted to foreground. New layers-glyph SVG; `MarketplaceVersionService.resolveExistence()` + cached per-id skip on `'missing'`; `useInternalCommands` setting fully removed; `autoRunDependencyChecks` verified wired; `GroupStore.validateGroup()` + `upsert()` guard against empty user groups; CLAUDE.md audit adds the three subagent-environment failure modes. 124 → 135 tests. |
| **Feature: Extension-dependency-graph awareness** | ~40 min foreground | 1 | 574 | 66 | 508 | — | Same session; shared the foreground-only pivot. `ExtensionService` gains `getDependencyGraph` / `transitiveDependencies` / `computeBlockedByDependents` / `topologicalUninstallOrder`. `applyGroup` rewritten to auto-include transitive deps, refuse to break the graph, and uninstall in topological order. `GroupsTreeProvider` extension nodes become collapsible with dep/pack children. New `reloadAfterApply` setting + consolidated prompt at end of apply. 135 → 148 tests. |
| **Feature: l10n externalization (per AFV pattern)** | ~40 min foreground | 1 | 694 | 156 | 538 | — | `package.json` switched to `%key%` placeholders resolved by new `package.nls.json`. New `src/localization/` module (`LocalizationKeys` enum + `localizationValues` map + `getLocalization()` helper wrapping `vscode.l10n.t`). Swept every show-message / quick-pick / status-bar / tree-item user-facing string. New `npm run l10n` script, seeded `l10n/bundle.l10n.json`, CI-guard test asserting every key has a default. `CONTRIBUTING.md` gets a Translating section; `CLAUDE.md` adds the externalized-strings rule. 148 → 151 tests. |

## Summary (keep up to date)

- **Total repository** (all non-merge commits, excluding `package-lock.json`): **+7,655 / −658 lines (net +6,997)**.
- **Total commits**: 34 on `main` (including 3 merges), plus 3 commits on retired feature branches that were merged and cleaned up, and 2 abandoned branches from the second parallel-agent attempt that made no changes and were deleted.
- **Tests**: **151 passing** across 15 suites.
- **Packaged VSIX**: 16 files, ~35 KB (grew from 22 KB with the l10n assets — `package.nls.json` + `l10n/bundle.l10n.json` seed).
- **Known token usage**: 73,214 (Phase 6) + 75,771 (dedup) + 132,302 (versions/updates) = **281,287 measured across the three successful subagents**. Two additional subagents (dep-graph-cluster + cleanups) were launched but died on Bash denial before doing any work; their tokens (13,004 + 13,555 = 26,559) produced no output and are noted for completeness.
- **Phases complete**: 0 through 10 (all v0.1 scope). Nine §9 TODOs delivered this session (cleanups batch + dep-graph cluster + l10n externalization). Four remain open (React group contents, Phase 11 niceties, `checkForUpdates` wiring, CLAUDE audit).
- **Open follow-ups**: See `PLAN.md` §9 — down to Phase 11 niceties (import/export / workspace groups / keybindings), `checkForUpdates` native-command wiring, the CLAUDE audit, and the four manual F5 smoke tests only you can run.
