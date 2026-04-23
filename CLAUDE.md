# Claude / AI-agent directions for this repo

This file tells AI assistants (Claude Code, Copilot agent mode, etc.) how to
work effectively in `salesforcedx-vscode-manager`. It was distilled from the
Phase 0–10 build of v0.1 — patterns that worked, traps that were hit, and
decisions that should not be relitigated.

## Read these first

- **[`PLAN.md`](./PLAN.md)** — authoritative spec + phase checklist + §9 TODO
  backlog. Every substantial change should start here and end by updating a
  checkbox.
- **[`TRACKING.md`](./TRACKING.md)** — per-task LoC + token ledger. Add a row
  and refresh the summary for any non-trivial task.
- **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** — dev loop, quality gates, and
  the git-worktree recipe for running multiple agents in parallel without
  fighting GPG signing.
- **[`docs/telemetry-events.md`](./docs/telemetry-events.md)** — every
  telemetry event the manager emits, with properties / measurements.
  **Must be updated in the same commit** whenever you add, remove, or
  retune a typed emit helper in `src/services/telemetryService.ts`.
- **[`docs/notifications.md`](./docs/notifications.md)** — every
  user-facing toast / modal, plus the "intentionally silent" list.
  **Must be updated in the same commit** whenever you add, remove,
  mute, or retune a `notifyInfo` / `notifyWarn` / `notifyError` or a
  raw `show*Message` call.

## Quality gates (non-negotiable)

Before declaring any task complete, run **all three** from the repo root:

```bash
npm run compile
npm run lint
npm test
```

All three green, or the task isn't done. `compile` is type-check + esbuild;
`test` is Jest with coverage. If you need to add a new test, mirror the
existing pattern in the closest `test/unit/*.test.ts`.

## Architecture rules (apply-group, dependencies, VSIX)

These are decisions already made — do not re-litigate them without an
explicit user request:

- **Apply-group uses the `code` CLI**, not `workbench.extensions.action.*`.
  Those commands do not exist in current VSCode builds; we confirmed this
  via `vscode.commands.getCommands(true)`. Install/uninstall are the
  persistent mechanism. The `backend` setting is a hook for a future
  Profiles alternative but is not wired.
- **The manager never activates a target extension to probe it.** Reads go
  through `ext.packageJSON` (static). Disabled extensions still contribute
  to the Dependencies tree — that's the point of the
  `salesforceDependencies` contract.
- **Built-in groups ship in code** (`src/groups/builtInGroups.ts`) and are
  merged at read time with user entries in the setting. User entries with
  matching ids are overrides; deleting a user override reverts to the
  built-in. Do NOT move built-ins into `configurationDefaults`.
- **VSIX overrides never silently fall back to marketplace.** If a match
  exists but the install fails, surface it as a vsix failure (`exitCode≠0`,
  `source='vsix'`) — the user asked for local, say so when it didn't work.
- **No `extensionDependencies` on the manager itself.** It must function
  when every target extension is disabled.
- **User-facing strings are externalized.** `package.json` uses `%key%`
  placeholders resolved by `package.nls.json`; source strings route
  through `getLocalization(LocalizationKeys.foo, ...args)` from
  `src/localization/`. Never add a raw literal to a `show*Message`,
  Quick Pick `placeHolder`, status-bar tooltip, or tree-item
  description/tooltip. Log messages and internal identifiers stay
  inline — they're not user-facing. Adding a new string means adding
  an enum entry + value, not editing call sites with English text.
- **`ExtensionService.getDisplayName(id)` is the single label source.**
  Tree rendering, notification bodies, quick-pick items, and log/user
  report copy all route through it so users see `Apex Replay Debugger`
  instead of `salesforce.salesforcedx-vscode-apex-replay-debugger`.
  The resolver checks `vscode.extensions.getExtension`, falls back to
  the on-disk manifest, then the marketplace-catalog snapshot via the
  `setCatalogDisplayNameLookup` hook, then the raw id. Do not fabricate
  labels locally; if a caller needs a pretty name it asks the service.
- **Never call `vscode.window.show*Message` directly for state changes.**
  Apply / install / uninstall / update results go through
  `src/util/notify.ts` (`notifyInfo` / `notifyWarn` / `notifyError`),
  which always attaches at least one action button so VSCode does not
  auto-dismiss the toast before the user notices. Raw `show*Message`
  is only acceptable for modal confirmation prompts where the user's
  response is the point.
- **Default to no toast on success.** Notifications are for action,
  error, or progress — nothing else. If the tree, Problems view, or
  status bar already reflects the outcome of a command, do not fire a
  toast; log the result through `deps.logger.info(...)` so the output
  channel still has a trail. The rule of thumb:
  - **Drop** the success toast when the user can see the outcome in
    the tree / status bar (install, uninstall, update, create-group,
    edit-group, delete-group, move-scope, enable-all, disable-all,
    check-for-updates, refresh-catalog on success, clear-vsix-
    overrides, dep-check when everything is green, copy-dep-report).
  - **Keep** a toast when there's something the tree can't show: an
    error, a partial failure, a bulk op with no per-row visual
    (update-all-failed, browse-install-summary-failed), a needs-
    action prompt (reload-after-apply, vsix-dir-missing), a modal
    confirmation, or an empty-state response to a user-initiated
    command that would otherwise look like nothing happened
    (browse-empty, refresh-catalog-empty, vsix-no-files).
  - **Always** use `withProgress` for long-running operations —
    that's the intentional progress channel; no change needed.
  - If a new command would toss a toast on success, first ask:
    "does the tree / status bar / Problems view already show this
    outcome?" If yes, log instead. Do NOT add a per-command
    `suppressSuccessToast` flag — the rule is the default, not a
    toggle.
- **`getDependencyGraph` reads disk for mid-session installs.**
  `vscode.extensions.all` only refreshes on reload, so
  `ExtensionService.augmentGraphFromDisk` scans
  `~/.vscode/extensions/<id>-<version>/package.json` and merges any
  `extensionDependencies` / `extensionPack` entries into the live
  graph. Every consumer of the graph calls `getDependencyGraph()`, not
  a one-shot snapshot — do not cache the result across an
  install/uninstall boundary.
- **`applyGroup` re-snapshots the graph after the install pass.**
  A fresh install during apply can pull in deps that our pre-install
  graph did not know about (this is what caused `einstein-gpt` to get
  uninstalled when applying the Apex group). Any change to the applier
  must preserve the "install → re-snapshot graph → then disable/
  uninstall" ordering. If you add a new phase to apply, re-snapshot
  between phases that can invalidate the graph.
- **Telemetry is a hard dep on `salesforcedx-vscode-core`.** The manager
  lists `salesforce.salesforcedx-vscode-core` in its
  `extensionDependencies`; telemetry comes from there via
  `@salesforce/vscode-service-provider`'s
  `ServiceProvider.getService(ServiceType.Telemetry, EXTENSION_ID)`.
  This is a published npm package and is what AFV
  (`salesforcedx-vscode-einstein-gpt`) uses. Do **not** remove the
  `extensionDependencies` entry to "decouple" — the whole pattern
  depends on core being present and activated first. `TelemetryService`
  (`src/services/telemetryService.ts`) wraps acquisition with typed
  emit helpers (`sendActivation`, `sendGroupApply`,
  `sendExtensionOp`, `sendCatalogRefresh`, `sendDependencyCheck`,
  `sendError`) and is the **only** place that should touch the reporter
  — every new command emits through a typed helper, no raw
  `sendCommandEvent('...')` calls in feature code.
- **Every new state-changing command fires a telemetry event.** The
  audit rule in the notification doc is: if the user can see the
  outcome in the tree / status bar, don't toast — but do log AND emit.
  New commands should add a typed helper on `TelemetryService` rather
  than fall through to the generic `sendCommandEvent` path.
- **Payloads carry no PII.** Extension ids, group ids, scope enums,
  counts, durations, exit codes are fine. File paths, workspace
  names, usernames, org ids are not. When in doubt, don't send it —
  add a log line instead.
- **Locked extensions are visible-but-not-actionable.** The manager's
  own `extensionDependencies` chain is force-installed by VSCode and
  can't be uninstalled while the manager is present.
  `ExtensionService.isLocked(id)` BFS-expands the chain from our own
  manifest (through installed extensions' manifests for transitive
  hops), and the tree / command handlers / applier all respect it:
  1. `GroupsTreeProvider` adds a `:locked` suffix to the
     `contextValue`, a "required" badge to the description, and a
     "required by" line to the tooltip.
  2. `package.json` `view/item/context` entries for install /
     uninstall have `!(viewItem =~ /:locked/)` — the inline buttons
     simply don't render for locked rows.
  3. `uninstallExtension` early-returns with a sticky info toast when
     `isLocked(id)` is true (defense-in-depth for palette dispatch).
  4. `applyGroup` (disableOthers) filters locked ids out of the
     candidate-disable set; `disableAllSalesforce` does the same.
  Do NOT special-case the ids (`salesforce.salesforcedx-vscode-core`,
  etc.) — always ask `isLocked(id)`. The source of truth is our own
  manifest.
- **Per-extension uninstall cascades through `transitiveDependents`.**
  `uninstallExtension` enumerates transitive dependents via
  `ExtensionService.transitiveDependents`, shows one modal listing the
  cascade, and then uninstalls in `topologicalUninstallOrder` (leaves
  first). This is the only way the `code` CLI accepts the uninstall;
  otherwise it errors with `Cannot uninstall X. Y depends on this.`
  Do not add a "force uninstall" path that bypasses the cascade —
  VSCode does not expose one, and silently skipping the dependents
  strands them in a broken state.

## Code style

- TypeScript strict mode. No `any` in `src/`; narrow casts only in tests
  when mocking vscode.
- Prefer named exports and plain classes. No decorators. No DI framework.
- Keep services thin and composable (`SettingsService`, `ProcessService`,
  `CodeCliService`, `WorkspaceStateService`, `ExtensionService`). New
  features add a new service or extend an existing one; they do not sprinkle
  `child_process` calls or `vscode.workspace.getConfiguration` calls into
  features directly.
- Tree providers use the `EventEmitter<Node | undefined>` refresh pattern.
  One `.fire(undefined)` to mean "re-read everything."
- View-title and context-menu buttons render as icons only when the
  contributed command has an `"icon"` field in `package.json`. If you add a
  palette command that also wants to be a button, include the codicon.

## Commits + branches

- Conventional-commit prefixes: `feat`, `fix`, `chore`, `docs`, `test`,
  `refactor`. Phase commits tag with the phase: `feat(phase-6): ...`.
- One commit per logical unit. Don't batch ten phases into one commit.
- Commit message body = *why* the change, not *what* (the diff shows what).
  Include any test counts, LoC, and user-visible behavior shifts that a
  future archaeologist needs.
- Never skip hooks (`--no-verify`) or bypass signing (`--no-gpg-sign`)
  without explicit user instruction. If signing blocks you, use a worktree
  with `git config commit.gpgsign false` (see `CONTRIBUTING.md`).

## Working with subagents

- Split along **file boundaries, not phase boundaries**. Two agents can
  safely work on non-overlapping files in parallel worktrees.
- High-friction files (expect merge conflicts if two agents touch these
  concurrently): `PLAN.md`, `TRACKING.md`, `package.json`,
  `src/views/groupsTreeProvider.ts`, `src/services/extensionService.ts`,
  `src/groups/groupApplier.ts`, `CHANGELOG.md`.
- **Subagent environment caveats observed this session:**
  - Some subagent environments disable `git` commands entirely against
    sibling worktree paths, even with `dangerouslyDisableSandbox`. Agents
    in this mode can still `Read`/`Edit`/`Write` and (sometimes) run
    `npm`; the foreground agent must commit on their behalf from the
    worktree.
  - Other subagent environments disable Bash completely. Those agents
    cannot `npm run compile`, `git config`, or `ls` — they're dead on
    arrival for code tasks. Detect this early by asking the agent to
    run `git status` as its first call; if it's denied, bail out and
    do the work foreground.
  - The gpg-pinentry wall blocks ANY commit in a worktree unless the
    foreground agent runs `git config commit.gpgsign false` in that
    worktree first. Bake this into the brief.
- **Briefing template** — every subagent prompt should include: its
  workspace path, the commit-signing bypass command, an explicit
  allowlist/denylist of writable files, the three quality gates, and a
  word-capped report format.
- **Overlap check before launch.** Grep for the files each agent would
  touch. If two agents need the same file, serialize them or split the
  responsibilities inside the file (e.g., "agent A owns `applyGroup`,
  agent B owns `ApplyResult.skipped`").
- **Foreground pivot when subagents die early.** If a backgrounded
  subagent's first Bash call is denied, do not retry — the environment
  is hard-blocked. Kill the worktree, clean up the branch, and do the
  work foreground. This is faster than re-briefing and cheaper than
  debugging the harness. It's how this session landed the dep-graph
  cluster after the second parallel attempt failed.
- **Agent-generated commit messages must cite the test count delta.**
  `X → Y tests` is the cheapest signal that nothing regressed during a
  big change; reviewers grep for it. Every feature/fix commit from an
  agent should carry it in the body.

## Diagnostic-first debugging

Before guessing at a fix for runtime behavior:

1. Check whether the assumed API actually exists:
   `await vscode.commands.getCommands(true)` for internal command ids,
   `vscode.extensions.getExtension(id)` for presence, `ext.packageJSON` for
   shape.
2. Write the finding to the extension's output channel so the user can copy
   it back verbatim. `Logger.show()` + a `sfdxManager.showLog` palette
   command already exist — use them.
3. Only then propose a fix. The log is authoritative; guesses from training
   data are not.

This is how we caught that `workbench.extensions.action.enableExtension`
doesn't exist in current VSCode. Do the same for future runtime mysteries.

## Checklists to tick as you go

When you finish something:

- [ ] All three quality gates green (compile + lint + test).
- [ ] Corresponding checkbox in `PLAN.md` (phase or §9 TODO) ticked.
- [ ] `CHANGELOG.md` updated under `[Unreleased]` if user-visible.
- [ ] `TRACKING.md` row added or updated.
- [ ] If the diff touched telemetry (new / changed / removed event or
      helper on `src/services/telemetryService.ts`),
      `docs/telemetry-events.md` reflects it.
- [ ] If the diff touched notifications (new / changed / muted /
      removed `notify*` or `show*Message` call),
      `docs/notifications.md` reflects it — either as a new row or by
      moving the call into the "Intentionally silent paths" list.
- [ ] Conventional-commit message with the *why*.
