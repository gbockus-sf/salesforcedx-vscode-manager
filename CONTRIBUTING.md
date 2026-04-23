# Contributing

## Prerequisites

- Node 20+
- A `code` (VSCode) or `code-insiders` CLI on your `PATH`
- macOS / Linux / Windows all supported (the scanner and code-cli service
  handle platform differences internally)

## Getting the extension running

```bash
git clone <this repo>
cd salesforcedx-vscode-manager
npm install
npm run compile          # tsc --noEmit + esbuild -> dist/
```

Then open the folder in VSCode and press **F5** to launch the Extension
Development Host. The activity-bar icon appears on the left; Command Palette
entries are under the `SFDX Manager:` category.

## Quality gates

All three must pass locally and in CI before merging:

```bash
npm run lint
npm test                 # jest with coverage
npm run compile
```

## Packaging a VSIX

```bash
npm run bundle:vsix
```

Produces `salesforcedx-vscode-manager-<version>.vsix` in the repo root. CI
does this on tagged releases.

## Working with AI agents on this repo

### The gpg-signing caveat

The maintainer's local `.gitconfig` sets `commit.gpgsign = true`. AI agents
run in a non-interactive sandbox and cannot answer the `gpg-agent` pinentry
prompt, so every `git commit` from a backgrounded agent fails with
`gpg: signing failed: No passphrase given` until something unlocks the
agent.

When splitting work into a parallel subagent, put that agent's work in a
**git worktree** and turn off signing for **that worktree only**:

```bash
# From the main checkout:
git worktree add -b feat/my-feature ../salesforcedx-vscode-manager-my-feature HEAD

# In the new worktree, BEFORE the agent starts committing:
cd ../salesforcedx-vscode-manager-my-feature
git config commit.gpgsign false
```

The setting is local to the worktree's `.git/config`, so the main worktree
remains signed. When the branch is merged back, the merge commit is produced
in the main worktree and signed as usual.

### Worktree cleanup

When the feature is merged and you're done with the worktree:

```bash
git worktree remove ../salesforcedx-vscode-manager-my-feature
git branch -d feat/my-feature
```

### Splitting work safely

Two subagents can run in parallel without merge pain as long as their file
sets don't overlap. Rough rules of thumb for this repo:

- `src/views/groupsTreeProvider.ts` and `src/services/extensionService.ts`
  are hot spots — expect most feature work to touch at least one.
- `src/dependencies/*` is isolated; changes there rarely conflict with
  groups work.
- `src/vsix/*` is isolated from both.
- `package.json` is a merge-friction magnet; additive changes (new commands,
  new settings) almost always merge cleanly, but expect to resolve by hand.
- `PLAN.md` and `TRACKING.md` are narrative docs — when two agents both
  tick checkboxes, merge conflicts are trivial but unavoidable. Assign each
  agent its own TODO section or resolve manually on merge.

## Translating

All user-facing strings are externalized.

### Two translation surfaces

1. **`package.json` contributions** (command titles, view names,
   configuration descriptions, walkthrough steps). English defaults live
   in `package.nls.json` under keys like
   `salesforcedx-vscode-manager.command.applyGroupQuickPick.title`. To
   add a translation, ship `package.nls.<locale>.json` (e.g.,
   `package.nls.ja.json`) next to it with the same keys.
2. **Runtime strings in `src/**/*.ts`** (toasts, Quick Pick prompts,
   status-bar tooltips, tree-item descriptions). English defaults live
   in `src/localization/localizationValues.ts`. Callers never pass raw
   strings — they invoke
   `getLocalization(LocalizationKeys.someKey, ...args)`. To add a
   translation, ship `l10n/bundle.l10n.<locale>.json` with a map from
   the **English source string** (the value from `localizationValues`)
   to the translated string.

### Adding a new key

1. Add the enum entry to `src/localization/localizationKeys.ts`.
2. Add the default English value to
   `src/localization/localizationValues.ts`.
3. Swap the call site to `getLocalization(LocalizationKeys.newKey, ...)`.
4. Run `npm test` — `test/unit/localization.test.ts` fails CI if a key
   has no value, which catches drift.
5. If the new string references `{0}` / `{1}` placeholders, test with
   the expected positional args.

### Regenerating the bundle

```bash
npm run l10n
```

Runs `@vscode/l10n-dev export --outDir ./l10n ./src`. For our enum-lookup
pattern the output is usually empty (the exporter scans for literal
`vscode.l10n.t('...')` calls, not indirected lookups), so the
`l10n/bundle.l10n.json` seed is just `{}`. Translators ship their own
`bundle.l10n.<locale>.json` keyed by the English source strings in
`localizationValues.ts`.

## Keeping the effort ledger current

After any substantial task, update [`TRACKING.md`](./TRACKING.md):

1. Add or update a row in the per-task ledger.
2. Refresh the "Summary" block at the bottom.

LoC deltas can be pulled from:

```bash
git log --no-merges --pretty=format:"%H" --grep="<commit-filter>" \
  | while read -r h; do git show --numstat --format= "$h" -- . ':!package-lock.json'; done \
  | awk '{add+=$1; del+=$2} END {printf "+%d -%d\n", add, del}'
```

Token counts from background subagents appear in their completion
notifications; copy them into the ledger when they arrive.
