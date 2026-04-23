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
- [ ] Conventional-commit message with the *why*.
