# salesforcedx-vscode-manager — Implementation Plan

> **This document is the source of truth for the build.** The very first implementation step copies this file into the new repo as `PLAN.md`. From that point on, the in-repo `PLAN.md` is the authoritative, version-controlled tracker — every phase below has checkboxes that get marked as work lands, and the file travels with the PR history.
>
> **Effort ledger:** see [`TRACKING.md`](./TRACKING.md) for per-phase LoC, commit counts, and token usage (where measured). Update that file's "Summary" block whenever a row lands.

---

## 1. Context

Salesforce ships ~19 first-party VSCode extensions (plus six third-parties in the expanded pack). A developer working on Apex rarely needs Lightning/LWC tooling active, and vice versa — keeping everything enabled slows activation, clutters menus, and occasionally causes feature conflicts. Separately, there is no unified place to verify external prerequisites (Salesforce CLI, Java, Node) — each extension does its own ad-hoc check (see `/Users/gbockus/github/IDEx/salesforcedx-vscode/packages/salesforcedx-vscode-apex/src/requirements.ts`). Finally, QA and developers routinely need to swap a production (marketplace) extension for a local unreleased `.vsix` build; today that's a fragile manual process.

**Outcome.** A new standalone VSCode extension, `salesforcedx-vscode-manager`, that:
1. Switches between named groupings of Salesforce extensions (Apex, Lightning, React, custom) from Command Palette, native Tree UI, or the status bar.
2. Shows a Dependencies tree driven by a new declarative `salesforceDependencies` field that each Salesforce extension can add to its own `package.json`.
3. Supports a local VSIX override directory — when set, local `.vsix` files are installed in place of the marketplace version (for testing unreleased builds).
4. Surfaces the current group + VSIX mode in the bottom status bar, clickable to change.

**Repo location.** `/Users/gbockus/github/IDEx/salesforcedx-vscode-manager` (standalone, sibling of the monorepo, own git repo). Publisher `salesforce`.

---

## 2. Key design decisions

**D1. Enable / disable mechanism — per-operation hybrid.**
- **Install / uninstall (persistent):** shell out to the `code` CLI — `code --install-extension <id-or-vsix-path>` / `--uninstall-extension <id>`. Stable, documented. Resolve the executable via `vscode.env.appRoot` + known relative path, with a `PATH` fallback.
- **Enable / disable (runtime toggle):** invoke internal commands `workbench.extensions.action.enableExtension` / `disableExtension`. Undocumented but de-facto stable. Wrap in try/catch; on failure open the Extensions view with a pre-filtered search + notification.
- Setting `salesforcedx-vscode-manager.useInternalCommands` (default `true`) gates the risky path.

**D2. Group storage.** Single setting `salesforcedx-vscode-manager.groups`, object keyed by group id. Built-ins shipped in code at `src/groups/builtInGroups.ts` and merged at read time — user entries with matching ids are treated as overrides. Built-ins remain upgradable across releases.

**D3. Built-in group membership (v0.1).**
- **Apex:** `salesforcedx-vscode-core`, `-apex`, `-apex-debugger`, `-apex-replay-debugger`, `-apex-log`, `-apex-oas`, `-apex-testing`, `-soql`, `-visualforce`, `redhat.vscode-xml`.
- **Lightning:** `-core`, `-services`, `-lightning`, `-lwc`, `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `salesforce.lightning-design-system-vscode`.
- **React:** empty stub + README TODO; user fills via `Edit Group`.

**D4. Apply scope — user-configurable.** Setting `salesforcedx-vscode-manager.applyScope`:
- `"disableOthers"` *(default)* — enable members; disable any managed extension (Salesforce + user-listed third-parties) not in the group.
- `"enableOnly"` — enable members; never disable.
- `"ask"` — prompt on apply; remember per-group choice in workspace state.

Per-group `Group.applyScope` overrides the setting.

**D5. Declarative dependency contract — `salesforceDependencies` at package.json root.** Manager reads statically via `vscode.extensions.getExtension(id).packageJSON` **without activating the extension** (critical — disabled extensions still advertise requirements).

```jsonc
{
  "name": "salesforcedx-vscode-apex",
  "salesforceDependencies": [
    {
      "id": "java-jdk",
      "label": "Java JDK 11+",
      "category": "runtime",
      "check": {
        "type": "env",
        "env": "JAVA_HOME",
        "fallback": { "type": "exec", "command": "java", "args": ["-version"], "minVersion": "11.0.0" }
      },
      "remediation": "Install Temurin 17+ and set JAVA_HOME",
      "remediationUrl": "https://adoptium.net/"
    }
  ]
}
```

v0.1 `check.type` values: `exec`, `env`, `file`, `nodeVersion`, `extensionInstalled`. `exec` supports `versionRegex` + `minVersion` (semver). Fallback when an extension hasn't adopted the contract: a built-in **shim catalog** at `src/dependencies/shimCatalog.ts`.

**D6. No `extensionDependencies`.** Manager must function when target extensions are disabled.

**D7. VSIX override directory — new v0.1 feature.**

Setting `salesforcedx-vscode-manager.vsixDirectory` (string, default `""`). When non-empty:
1. On **install / apply** for a managed extension id, the manager scans that directory for files matching `<publisher>.<name>-<version>.vsix` (vsce's default output format).
2. If a local VSIX is found, manager runs `code --install-extension <absolute-vsix-path> --force` instead of installing from the marketplace. `--force` instructs VSCode to replace the currently installed build regardless of version comparison.
3. If no local VSIX is found for a given id, fall back to `code --install-extension <id>` (marketplace).
4. Manager tracks install provenance in `context.globalState` (`installSource: Map<extId, 'vsix' | 'marketplace'>`) so the UI can show where each installed extension came from.
5. A new command `SFDX Manager: Refresh from VSIX Directory` re-scans and re-installs each managed extension from its local VSIX (no-op when `vsixDirectory` is unset).
6. A command `SFDX Manager: Open VSIX Directory` opens the directory in the OS file explorer (via `vscode.env.openExternal(Uri.file(...))`).
7. A command `SFDX Manager: Clear VSIX Overrides` uninstalls all extensions currently sourced from VSIX and reinstalls them from the marketplace.

**UX niceties:**
- When `vsixDirectory` is set, the Groups tree labels each extension node with a `$(package)` codicon and tooltip "Installed from local VSIX: <filename>".
- A `FileSystemWatcher` on the VSIX directory refreshes the tree when files are added/removed.
- If the directory is set but doesn't exist, show a one-time warning notification with "Create Directory" / "Choose Another" actions.

**D8. Status bar indicator — new v0.1 feature.**

Two bottom-left `StatusBarItem`s (left side — developer-identity rather than notifications):

| Item | Priority | Text | Tooltip | Click command |
|---|---|---|---|---|
| Group | 100 | `$(layers) Apex` | "Active SFDX group: Apex — click to switch" | `sfdxManager.applyGroupQuickPick` |
| VSIX | 99  | `$(package) VSIX: 3` *(count of ext currently sourced from VSIX)* | "3 extensions loaded from <vsixDir>. Click to manage." | `sfdxManager.vsixMenu` (Quick Pick: Refresh / Clear / Open Directory / Change Directory) |

- Group item always visible after activation; shows `$(layers) None` if no group has been applied this workspace.
- VSIX item **hidden** when `vsixDirectory` is unset; shown when set, with count = number of managed extensions currently flagged `installSource === 'vsix'`.
- Color: background `statusBarItem.warningBackground` when VSIX mode is active, to make it visually obvious this workspace is running non-production builds.
- Both items persist across reloads by reading workspace state on activation.

**D9. UI layout.**
- Activity bar container `sfdxManager` with custom SVG (`resources/icons/sfdx-manager.svg`).
- Two views: `sfdxManager.groups` and `sfdxManager.dependencies`.
- Groups tree: group nodes → member extension nodes; icons reflect installed/enabled/missing/vsix-sourced.
- Dependencies tree: categories (`cli` / `runtime` / `per-extension`); leaves use codicons `$(check)` / `$(warning)` / `$(error)` / `$(question)`.
- Quick Pick for Apply, Create, Edit.

**D10. Activation.** `onStartupFinished`. Dep checks run on view expansion / on command / on startup only if `autoRunDependencyChecks === true`.

**D11. Build / tooling.** Plain npm + esbuild + Jest + ts-jest. Scaffolded off `/Users/gbockus/github/AFV/salesforcedx-vscode-einstein-gpt/{esbuild.js,tsconfig.json,jest.config.js,package.json}`. `engines.vscode: ^1.86.0`, TypeScript strict, ES2021 target, BSD-3 license.

---

## 3. Repository layout

```
/Users/gbockus/github/IDEx/salesforcedx-vscode-manager/
├── PLAN.md                            # THIS FILE (copied from ~/.claude/plans on first commit)
├── .github/workflows/ci.yml
├── .vscode/launch.json
├── .vscodeignore
├── .gitignore
├── esbuild.js
├── eslint.config.mjs
├── jest.config.js
├── tsconfig.json
├── package.json
├── README.md                          # user docs + salesforceDependencies contract spec
├── CHANGELOG.md
├── LICENSE                            # BSD-3
├── resources/icons/sfdx-manager.svg
├── src/
│   ├── extension.ts                   # activate: services, views, commands, status bar
│   ├── constants.ts
│   ├── groups/
│   │   ├── types.ts
│   │   ├── builtInGroups.ts
│   │   ├── groupStore.ts
│   │   └── groupApplier.ts
│   ├── dependencies/
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   ├── runners.ts
│   │   ├── shimCatalog.ts
│   │   └── versionCompare.ts
│   ├── vsix/
│   │   ├── types.ts                   # VsixOverride { extensionId, version, filePath }
│   │   ├── vsixScanner.ts             # directory scan, filename parsing, file watcher
│   │   └── vsixInstaller.ts           # install from local vsix vs marketplace, provenance tracking
│   ├── statusBar/
│   │   ├── groupStatusBarItem.ts      # shows active group, click → switch
│   │   └── vsixStatusBarItem.ts       # shows vsix count, click → management menu
│   ├── views/
│   │   ├── groupsTreeProvider.ts
│   │   └── dependenciesTreeProvider.ts
│   ├── commands/
│   │   ├── index.ts
│   │   ├── groupCommands.ts
│   │   ├── dependencyCommands.ts
│   │   └── vsixCommands.ts
│   ├── services/
│   │   ├── extensionService.ts        # enable/disable/install/uninstall + routing to vsix installer
│   │   ├── settingsService.ts
│   │   ├── processService.ts
│   │   ├── codeCliService.ts
│   │   └── workspaceStateService.ts   # active group + installSource map
│   └── util/
│       ├── logger.ts
│       └── envExpand.ts
└── test/unit/
    ├── groupStore.test.ts
    ├── groupApplier.test.ts
    ├── runners.test.ts
    ├── registry.test.ts
    ├── extensionService.test.ts
    ├── vsixScanner.test.ts
    └── vsixInstaller.test.ts
```

---

## 4. package.json contributions

- `activationEvents`: `["onStartupFinished"]`.
- `contributes.commands` (15, all `category: "SFDX Manager"`):
  - Groups: `applyGroup`, `applyGroupQuickPick`, `enableAllSalesforce`, `disableAllSalesforce`, `createCustomGroup`, `editGroup`, `deleteGroup`, `openGroupsConfig`.
  - Dependencies: `showDependencies`, `runDependencyCheck`, `copyDependencyReport`.
  - VSIX: `refreshFromVsixDirectory`, `openVsixDirectory`, `clearVsixOverrides`, `vsixMenu`.
- `contributes.viewsContainers.activitybar`: one (`sfdxManager`).
- `contributes.views.sfdxManager`: two (groups, dependencies).
- `contributes.menus`: `view/title` (refresh, create, run-check, copy-report), `view/item/context` (apply/edit/delete, recheck, open-remediation-url, reinstall-from-vsix).
- `contributes.configuration`:
  - `salesforcedx-vscode-manager.groups` *(object, default `{}`)*.
  - `salesforcedx-vscode-manager.applyScope` *(enum, default `disableOthers`)*.
  - `salesforcedx-vscode-manager.useInternalCommands` *(boolean, default `true`)*.
  - `salesforcedx-vscode-manager.autoRunDependencyChecks` *(boolean, default `false`)*.
  - `salesforcedx-vscode-manager.thirdPartyExtensionIds` *(string[])*.
  - **`salesforcedx-vscode-manager.vsixDirectory`** *(string, default `""`, scope `machine-overridable`)*.
  - **`salesforcedx-vscode-manager.vsixAutoReinstallOnChange`** *(boolean, default `false`)* — re-install when the watcher sees a new VSIX.
  - **`salesforcedx-vscode-manager.statusBar.showGroup`** *(boolean, default `true`)*.
  - **`salesforcedx-vscode-manager.statusBar.showVsix`** *(boolean, default `true`)*.
- `contributes.walkthroughs`: "Get started with the Salesforce Extensions Manager" — pick a group / view deps / configure VSIX directory.

---

## 5. Key component signatures

```ts
// groups/types.ts
export type ApplyScope = 'disableOthers' | 'enableOnly' | 'ask';
export interface Group { id: string; label: string; description?: string; extensions: string[]; applyScope?: ApplyScope; builtIn?: boolean; }

// groups/groupApplier.ts
export interface ApplyResult { enabled: string[]; disabled: string[]; installedFromVsix: string[]; skipped: { id: string; reason: string }[]; }
export async function applyGroup(group: Group, scope: ApplyScope, managedIds: string[], svc: ExtensionService): Promise<ApplyResult>;

// services/extensionService.ts
export class ExtensionService {
  managed(): vscode.Extension<unknown>[];
  isInstalled(id: string): boolean;
  isEnabled(id: string): boolean;
  enable(id: string): Promise<void>;
  disable(id: string): Promise<void>;
  install(id: string): Promise<{ source: 'vsix' | 'marketplace' }>;   // routes through vsixInstaller first
  uninstall(id: string): Promise<void>;
  readManifest<T = unknown>(id: string): T | undefined;
}

// vsix/types.ts
export interface VsixOverride { extensionId: string; version: string; filePath: string; }

// vsix/vsixScanner.ts
export class VsixScanner {
  constructor(dir: string);
  scan(): Promise<Map<string, VsixOverride>>;                         // keyed by extension id
  watch(onChange: () => void): vscode.Disposable;
}

// vsix/vsixInstaller.ts
export class VsixInstaller {
  constructor(scanner: VsixScanner, cli: CodeCliService, state: WorkspaceStateService);
  tryInstall(id: string): Promise<'vsix' | 'marketplace' | 'skipped'>;
  clearAllOverrides(): Promise<void>;                                 // reinstall everything from marketplace
  currentSources(): Map<string, 'vsix' | 'marketplace'>;              // from state
}

// dependencies/types.ts
export type CheckDefinition =
  | { type: 'exec'; command: string; args?: string[]; versionRegex?: string; minVersion?: string }
  | { type: 'env'; env: string; fallback?: CheckDefinition }
  | { type: 'file'; path: string }
  | { type: 'nodeVersion'; minVersion: string }
  | { type: 'extensionInstalled'; extensionId: string };

export interface DependencyCheck { id: string; label: string; category: 'cli' | 'runtime' | 'per-extension'; ownerExtensionId?: string; check: CheckDefinition; remediation?: string; remediationUrl?: string; }
export interface DependencyStatus { state: 'ok' | 'warn' | 'fail' | 'unknown'; detail?: string; version?: string; }

// statusBar/groupStatusBarItem.ts
export class GroupStatusBarItem { constructor(state: WorkspaceStateService); update(groupLabel: string | undefined): void; dispose(): void; }

// statusBar/vsixStatusBarItem.ts
export class VsixStatusBarItem { constructor(installer: VsixInstaller, settings: SettingsService); update(): void; dispose(): void; }
```

**Reuse references:**
- Tree refresh pattern — `/Users/gbockus/github/IDEx/salesforcedx-vscode/packages/salesforcedx-vscode-core/src/conflict/conflictOutlineProvider.ts`.
- Java detection — `/Users/gbockus/github/IDEx/salesforcedx-vscode/packages/salesforcedx-vscode-apex/src/requirements.ts` (port into `shimCatalog.ts`).
- `viewsContainers` / `views` shape — `/Users/gbockus/github/IDEx/salesforcedx-vscode/packages/salesforcedx-vscode-core/package.json` lines 206–223.
- Scaffolding (`esbuild.js`, `tsconfig.json`, `jest.config.js`, scripts) — `/Users/gbockus/github/AFV/salesforcedx-vscode-einstein-gpt/`.
- Typed settings access — `/Users/gbockus/github/AFV/salesforcedx-vscode-einstein-gpt/src/vscode/configuration/Settings.ts`.

---

## 6. Implementation phases — trackable checklist

> Check items off by editing `PLAN.md` in the new repo as each lands. Each phase is sized for a single PR.

### Phase 0 — Bootstrap the repo
- [x] `git init /Users/gbockus/github/IDEx/salesforcedx-vscode-manager`
- [x] Copy `PLAN.md` from `~/.claude/plans/i-want-to-build-keen-quill.md` into the new repo root
- [x] Add `.gitignore`, `LICENSE` (BSD-3), empty `CHANGELOG.md`, skeleton `README.md`
- [x] First commit: `chore: initial scaffold + PLAN.md`

### Phase 1 — Build & test scaffolding
- [x] `package.json` with metadata, scripts, devDeps (typescript, esbuild, jest, ts-jest, @types/vscode, @types/node)
- [x] `tsconfig.json` (strict, ES2021, ESNext, outDir `out`)
- [x] `esbuild.js` bundling `src/extension.ts` → `out/extension.js`, externals: `vscode`
- [x] `jest.config.js` + sample passing test
- [x] `eslint.config.mjs`
- [x] `.vscode/launch.json` for F5 Extension Host
- [x] `.github/workflows/ci.yml` running lint + test + compile
- [x] `npm run compile && npm test` green

### Phase 2 — Activation skeleton
- [x] `src/extension.ts` with `activate()` / `deactivate()` and an OutputChannel logger
- [x] `src/constants.ts` with command ids / view ids / setting keys
- [x] `src/services/settingsService.ts`, `processService.ts`, `codeCliService.ts`, `workspaceStateService.ts` (empty typed wrappers)
- [x] Activity-bar container + two empty view registrations (`sfdxManager.groups`, `sfdxManager.dependencies`)
- [x] Launch via F5, confirm container appears

### Phase 3 — Extension service
- [x] `src/services/extensionService.ts` — `managed()`, `isInstalled()`, `isEnabled()`, `readManifest()`
- [x] `enable()` / `disable()` via `workbench.extensions.action.*` with deep-link fallback behind `useInternalCommands`
- [x] `install()` / `uninstall()` via `code` CLI
- [x] Unit tests with mocked `vscode` + child_process

### Phase 4 — Groups model
- [x] `src/groups/types.ts`, `builtInGroups.ts` (Apex + Lightning populated, React stub)
- [x] `src/groups/groupStore.ts` with merge-by-id semantics + refuse-remove-builtin rule
- [x] `src/groups/groupApplier.ts` driving `ExtensionService` based on `ApplyScope`
- [x] `groupStore.test.ts`, `groupApplier.test.ts`

### Phase 5 — Group commands + tree view
- [x] `src/commands/groupCommands.ts` — apply, applyQuickPick, enableAll, disableAll, create, edit, delete, openGroupsConfig
- [x] `src/views/groupsTreeProvider.ts` (EventEmitter refresh pattern)
- [x] `contributes.commands`, `contributes.menus` wiring
- [x] Manual F5 smoke: apply Apex, apply Lightning, create custom, edit, delete

### Phase 6 — Dependency engine
- [x] `src/dependencies/types.ts`
- [x] `src/dependencies/runners.ts` — `exec`, `env`, `file`, `nodeVersion`, `extensionInstalled`
- [x] `src/dependencies/versionCompare.ts` (inline semver compare; no external dep)
- [x] `src/dependencies/shimCatalog.ts` — ports Java check from `requirements.ts`; adds shims for `-apex`, `-lwc`, `-core`
- [x] `src/dependencies/registry.ts` — static scan of `ext.packageJSON.salesforceDependencies` + shim merge
- [x] `runners.test.ts`, `registry.test.ts` (mocked filesystem + child_process)

### Phase 7 — Dependency commands + tree view
- [x] `src/commands/dependencyCommands.ts` — show, runCheck, copyReport
- [x] `src/views/dependenciesTreeProvider.ts` with category grouping + status icons + remediation tooltip
- [ ] Manual F5 smoke: render with healthy env, then break `java` and re-check *(pending user smoke test)*

### Phase 8 — VSIX override
- [x] `src/vsix/types.ts`
- [x] `src/vsix/vsixScanner.ts` — scan, filename parser (`<publisher>.<name>-<version>.vsix`), `FileSystemWatcher`
- [x] `src/vsix/vsixInstaller.ts` — `tryInstall()` routes to `code --install-extension <path> --force` when match found, otherwise marketplace id; records provenance in `workspaceStateService`
- [x] Rewire `ExtensionService.install()` to consult `VsixInstaller` first
- [x] `src/commands/vsixCommands.ts` — `refreshFromVsixDirectory`, `openVsixDirectory`, `clearVsixOverrides`, `vsixMenu`
- [x] Groups tree labels gain `$(package)` + tooltip for VSIX-sourced extensions
- [x] `vsixScanner.test.ts`, `vsixInstaller.test.ts`
- [ ] Manual F5 smoke: populate a folder with one real VSIX, set the setting, apply a group that includes it, verify provenance + tooltip *(pending user smoke test)*

### Phase 9 — Status bar
- [x] `src/statusBar/groupStatusBarItem.ts` — reads active group from workspace state, click → `applyGroupQuickPick`
- [x] `src/statusBar/vsixStatusBarItem.ts` — visible only when `vsixDirectory` set; count + warning background; click → `vsixMenu`
- [x] Respect `statusBar.showGroup` / `statusBar.showVsix` toggles
- [x] Update on: group apply, VSIX install, setting change, FS watcher event
- [ ] Manual F5 smoke: switch groups, observe both items update live *(pending user smoke test)*

### Phase 10 — Polish
- [x] `contributes.walkthroughs` with 4 steps (group, deps, vsix, status bar)
- [x] README: user guide + `salesforceDependencies` contract spec + VSIX workflow section
- [x] CHANGELOG 0.1.0 entry
- [x] `npx @vscode/vsce package` produces a clean `.vsix`
- [ ] Install into a fresh VSCode, run through §7 verification list *(pending user smoke test)*

### Phase 11 (nice-to-have v0.1.1)
- [x] Import / export group JSON — `SFDX Manager: Export Groups...` /
  `Import Groups...` commands, versioned payload (`{version:1}`),
  per-id conflict prompts (Overwrite / Skip / Skip All).
- [x] Workspace-scoped override of `groups` setting —
  `SettingsService.getGroupsByScope()` exposes user + workspace layers
  separately; `GroupStore.upsert/remove/moveToScope` route to the
  right `ConfigurationTarget`; new `SFDX Manager: Move Group to User
  / Workspace...` command; Groups tree shows a `user` / `workspace`
  badge next to each user-defined group.
- [x] Per-group "Open in Quick Pick" keybinding — global keybinding
  `Cmd+Alt+G` / `Ctrl+Alt+G` fires `sfdxManager.applyGroupQuickPick`.

---

## 7. Verification (run at end of Phase 10)

1. `cd /Users/gbockus/github/IDEx/salesforcedx-vscode-manager && npm install && npm run compile` — no TS errors.
2. `npm test` — jest green; coverage ≥70% on `src/groups/`, `src/dependencies/`, `src/vsix/`.
3. `npm run lint` — clean.
4. F5 Extension Host against a checkout of `/Users/gbockus/github/IDEx/salesforcedx-vscode/test-workspaces/`.
5. `SFDX Manager: Apply Group → Apex` → non-Apex Salesforce extensions disabled, Apex set enabled, reload prompt shown, `ApplyResult` matches notification.
6. Flip `applyScope` to `enableOnly` → re-apply Lightning → no disables.
7. Flip to `ask` → re-apply → prompt appears, choice persists for that group.
8. `SFDX Manager: Show Dependencies` → `sf` / `java` / `node` / `git` render correctly; rename `java` on PATH → `Run Dependency Check` → row flips to `fail` with remediation tooltip.
9. Add `salesforceDependencies` to a scratch extension's `package.json` while it's disabled → reload → row appears (confirms static manifest read without activation).
10. `Create Custom Group` → multi-select 4 extensions → save → appears in tree + `settings.json`.
11. `Edit Group` on Apex → verify user override written; `Delete` → reverts to built-in.
12. Set `useInternalCommands: false` → re-apply → Extensions view opens with `@installed` filter + notification.
13. **VSIX:** put one real Salesforce `.vsix` in a folder, set `vsixDirectory` → apply a group containing that extension → confirm `code --install-extension <path> --force` runs, tooltip shows "Installed from local VSIX", provenance recorded in workspace state.
14. `Refresh from VSIX Directory` reinstalls everything in scope. `Clear VSIX Overrides` uninstalls all VSIX-sourced and reinstalls from marketplace.
15. **Status bar:** group item shows current selection; VSIX item appears with warning background and correct count; clicking each opens the right Quick Pick / menu. Toggle the two `statusBar.show*` settings → items show/hide.
16. `npx @vscode/vsce package` → clean `.vsix`. Install into a fresh VSCode profile → activation under 500 ms via `Developer: Startup Performance`.

---

## 8. Roadmap beyond v0.1

- **v0.2** — Import/export groups, workspace-scoped groups, clickable install remediations, walkthrough polish.
- **v0.3** — Adoption PRs in the IDEx monorepo adding `salesforceDependencies` to each Salesforce extension; retire shim catalog as coverage grows. Optional VSCode Profiles backend (`backend: "profiles"`).
- **v0.4** — Telemetry via `@vscode/extension-telemetry`, `l10n/` localization, Playwright E2E mirroring `/Users/gbockus/github/AFV/salesforcedx-vscode-einstein-gpt/playwright.config.ts`.
- **v0.5** — Auto-download VSIXes from a configurable URL (e.g., CI artifact feed); signed/checksummed VSIX verification.

---

## 9. TODOs surfaced during build

These were discovered during implementation and aren't blocking v0.1 but
should be addressed before a real release.

- [x] **Topological uninstall order.** `ExtensionService.topologicalUninstallOrder()`
  sorts a candidate set so dependents (and packs) come off before their
  dependencies (and pack members). `applyGroup` uses it for the
  `disableOthers` uninstall pass.
- [x] **Skip unresolvable marketplace ids.** `ExtensionService.install()`
  now probes `MarketplaceVersionService.resolveExistence()` before the
  CLI attempt; a `'missing'` result short-circuits with exit 2 and a
  "not published" stderr. `'unknown'` (offline / timeout) falls through
  so disconnected machines keep working. Result cached per id for 1 h.
- [x] **React group contents.** Ship empty; user will fill via
  `Edit Group` per the plan. Confirm contents and repopulate before
  tagging v0.1.0.
- [x] **Activity bar icon visual — swap padlock for a layers glyph.**
  `resources/icons/sfdx-manager.svg` is now three filled rhombi forming
  a stacked-layers shape mirroring the status-bar `$(layers)` codicon.
  Filled paths (`fill="currentColor"`), 24×24 viewBox; same file path
  so `package.json` didn't need to change.
- [x] **Reload prompt fatigue.** New setting
  `salesforcedx-vscode-manager.reloadAfterApply` (`auto` / `prompt` / `never`,
  default `prompt`). `runApply` shows a single consolidated prompt after
  the apply finishes, instead of users seeing one VSCode reload banner per
  uninstall. `auto` reloads silently; `never` defers to VSCode's per-
  uninstall banners.
- [x] **GPG signing during local development.** Full recipe
  documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md) — each parallel
  agent worktree runs `git config commit.gpgsign false` locally so
  signing is bypassed only in the feature worktree, then the merge
  commit back to `main` is signed normally.
- [x] **`useInternalCommands` setting is now dead.** Removed from
  `package.json`, `src/constants.ts`, `src/services/settingsService.ts`,
  and the test mock. Users who had it set in `settings.json` will see
  VSCode surface it as "unknown setting" — harmless, and the cleanup
  pass can scrub it on next save.
- [x] **Dep checks never auto-run.** Verified: `extension.ts` line 144
  reads `settings.getAutoRunDependencyChecks()` and calls
  `dependenciesTree.runChecks()` when true. No change needed.
- [x] **Empty group -> no-op apply.** Handled at the save layer:
  `GroupStore.upsert()` now runs a new `validateGroup()` helper that
  refuses to save a user group with zero members (built-in overrides
  are still allowed to be empty since the built-in default merges in).
  This prevents an empty user group from ever being saved, so
  `applyGroup` can't be invoked against one. Three new unit tests.
- [x] **Worktree-based parallel agents.** Works but requires disabling
  gpg signing in the worktree. Recipe documented in
  [`CONTRIBUTING.md`](./CONTRIBUTING.md).
- [x] **Show each extension's VSCode `extensionDependencies` +
  `extensionPack` members in the Groups tree.** Extension nodes are
  now collapsible when their `packageJSON.extensionDependencies` or
  `.extensionPack` is non-empty, and expand to read-only child rows
  with `$(link)` for deps and `$(package)` for pack members.
  `contextValue` is `extension:child:dep` / `extension:child:pack` so
  future context menus can target them.
- [x] **Apply-group honors the extension-dependency graph.** `applyGroup`
  pulls every member's transitive `extensionDependencies` into the
  effective enable set (reported in the summary as "Dep auto-included:
  N"). Before disabling a non-member, a fixed-point search in
  `computeBlockedByDependents()` refuses to touch anything an
  installed outside-the-candidate-set extension still depends on —
  reported as `dependencyBlocked: [{ id, blockedBy }]`. This replaces
  VSCode's per-uninstall "Cannot uninstall X" warnings with structured
  state the summary toast and output log surface.
- [x] **Dedupe the Dependencies list by logical check, not just by id.**
  Today `DependencyRegistry.collect()` dedupes on `check.id`, but two
  different extensions can declare the same *logical* dependency
  (e.g., Java JDK 11+) with different ids (`apex.java-jdk`,
  `soql.java-jdk`) and both will show up in the tree. Proposal: key
  by a content fingerprint — same `check.type` + same primary
  arguments (command/env/path/minVersion) — and fold duplicates into
  one row with multiple `ownerExtensionId` entries shown in the
  tooltip. Built-in checks take precedence over shims take
  precedence over manifest-declared when fingerprints collide.
- [x] **Review CLAUDE.md against a second agent session.** First audit
  (cleanups pass): added the "Subagent environment caveats" block
  distinguishing three failure modes (full-Bash denial, sibling-worktree
  git denial, gpg-pinentry wall) and a briefing-template requirement.
  Second audit (Phase 11 pass): added the foreground-pivot escalation
  rule and a commit-message requirement to cite test-count deltas.
- [x] **Wire `sfdxManager.checkForUpdates` through our own
  MarketplaceVersionService refresh.** Initially this command also fired
  VSCode's native `workbench.extensions.action.checkForUpdates`, but
  that command pops a modal we can't suppress, so the follow-up pass
  dropped the native call. Users invoking our command now see only our
  structured tree refresh and a sticky "update check complete"
  notification. The built-in dialog is still reachable from the palette
  via `Extensions: Check for Extension Updates`.
- [x] **Externalize all user-facing strings** from both `package.json` and
  the extension source, following the Agentforce Vibes pattern at
  `/Users/gbockus/github/AFV/salesforcedx-vscode-einstein-gpt/` (which in
  turn follows VSCode's official `vscode.l10n` flow). Concretely:
  - `package.nls.json` at the repo root holds English defaults for every
    `%key%` reference in `package.json` (command titles, view names,
    configuration descriptions, walkthrough steps, etc.). Replace inline
    strings in `package.json` with `%salesforcedx-vscode-manager.<key>%`
    placeholders. Add `"l10n": "./l10n"` to the extension manifest.
  - `src/localization/{localizationKeys.ts, localizationValues.ts,
    getLocalization.ts, index.ts}` mirroring AFV: a `LocalizationKeys`
    enum, a `localizationValues` map, and a `getLocalization(key, ...args)`
    helper that calls `vscode.l10n.t(localizationValues[key], args)`. Every
    `vscode.window.show*Message`, `QuickPick` placeholder, status-bar
    tooltip, tree-item label fallback, and log message in `src/` routes
    through this helper.
  - `l10n/bundle.l10n.json` captures the same strings keyed by the
    English source (per the VSCode l10n tooling). Add a script
    (`npm run l10n`) that runs `npx @vscode/l10n-dev export --outDir
    ./l10n ./src` to regenerate the bundle from source comments
    (`vscode.l10n.t('...')`).
  - A sweep of `src/` that audits every string literal: UI copy gets
    externalized; log tags and internal identifiers stay inline.
  - Unit test that imports every `LocalizationKeys` entry and asserts
    `localizationValues[key]` is defined, so missing entries fail CI.
  - Update `CONTRIBUTING.md` with a "Translating" section pointing at
    the `package.nls.*.json` / `bundle.l10n.*.json` file pair
    convention, and add the recipe to `CLAUDE.md` so future agents
    don't regress by inlining strings.

  Reference files in AFV worth copying structurally:
  `package.nls.json`, `l10n/bundle.l10n.ja.json`,
  `src/localization/localizationKeys.ts`,
  `src/localization/localizationValues.ts`,
  `src/localization/getLocalization.ts`.
- [x] **Show installed version + update indicators in the Groups tree.**
  Each extension node now displays:
  - the currently installed version (read from
    `ext.packageJSON.version`, with a fallback to the parsed output
    of `code --list-extensions --show-versions`),
  - an `$(arrow-circle-up)` badge when a newer version is available
    in the marketplace,
  - a `$(package)` badge when the currently installed copy came from
    the VSIX override directory (with a walkthrough tooltip hint).
  Inline `Update Extension` action (per-node, visible only when
  `updateAvailable`) and view-title `Update All Salesforce
  Extensions` / `Check for Extension Updates` actions routed through
  `CodeCliService.installExtension(id, /*force=*/ true)`. Marketplace
  version discovery lives in
  `src/services/marketplaceVersionService.ts` (1 h in-memory cache,
  graceful no-op when offline), gated behind the new
  `salesforcedx-vscode-manager.updateCheck` enum setting
  (`onStartup` / `manual` / `never`, default `manual`). A
  periodic/background status-bar badge for pending updates is left
  as a follow-up.
- [x] **Switch notification copy from extension ids to display names.**
  Every `notifyInfo` / `notifyWarn` / `notifyError` call that
  includes an extension id in the message should route the id
  through `ExtensionService.getDisplayName(id)` (with the
  marketplace catalog lookup as a fallback) and show the human
  name the user recognizes — e.g., "Uninstalled Agentforce Vibes."
  instead of "Uninstalled salesforce.salesforcedx-einstein-gpt."
  Keep the raw id in the output-channel log lines; the change is
  toast-text only.

  Call sites to audit:
  - `src/commands/updateCommands.ts`: `installExtensionSucceeded`,
    `installExtensionAlreadyInstalled`, `installExtensionFailed`,
    `uninstallExtensionConfirm`, `uninstallExtensionSucceeded`,
    `uninstallExtensionSucceededCascade` (cascade members too),
    `uninstallExtensionNotInstalled`,
    `uninstallExtensionCascadeConfirm` (list members by display
    name), `updateSucceeded`, `updateFailed`.
  - `src/commands/catalogCommands.ts`: `browseInstallSummaryFailed`
    per-id log lines.
  - `src/services/extensionService.ts` `showManualToggleHint` —
    currently lists raw ids; pluralize by display name.

  Prioritize modal confirm dialogs (uninstall cascade) — users
  have to read them. Centralize the lookup-then-fallback dance
  as a helper (`ExtensionService.label(id)` → display name,
  falling back to the raw id) so every call site is a one-liner.
  Tests: assert the formatted string contains the display name
  when known, and still falls back to the id when
  `getDisplayName` returns undefined.

- [x] **Notification audit — only notify when there's an action,
  error, or progress to report.** The extension is noisy today: every
  command and most settled async ops toss a toast, and VSCode stacks
  them at the bottom-right where they compete with our own "update
  available" indicators, sticky-reload prompts, and the legitimate
  error surface. The user's rule of thumb:

  > I only need a notification if there's an action to be taken, an
  > error, or progress being reported.

  Concrete offender (from the dep-check screenshot): "Dependencies:
  4 ok" pops after the user runs `Run Dependency Check`, even though
  every row in the Dependencies tree already turned green. The toast
  is redundant — the tree is the source of truth. It should only fire
  when the check surfaces something actionable (missing / wrong
  version), and then the toast should include a "Show Dependencies"
  button so it actually leads somewhere.

  Sweep plan:
  1. Build a decision table of every `notifyInfo` / `notifyWarn` /
     `notifyError` + raw `vscode.window.show*Message` call in `src/`.
     For each one, classify the result state (success-happy-path,
     success-with-partial-failure, no-op, error, needs-action) and
     decide whether the user cares when they can't already see the
     outcome in the tree, status bar, or Problems view.
  2. Drop the pure "completed successfully with no follow-up" toasts
     entirely. First-pass kill list (tentative — double-check each):
     - `Dependencies: N ok` (dep commands) — only notify on
       missing/warn/fail; drop the all-green case.
     - `Salesforce catalog: N extensions cached.` — status is
       already visible in the tree badge; keep only the
       `refreshCatalogEmpty` warn path.
     - `SFDX Manager: update check complete.` — the tree's
       `$(arrow-circle-up)` badges do the talking.
     - `Updated <ext>.` / `Installed <ext>.` /
       `Uninstalled <ext>.` — the row in the Groups tree re-renders
       with the new state within a tick; keep the toast only when
       something failed (already have separate `*Failed` strings).
       Consider a single summary toast for `updateAllSalesforce`
       since that one has no per-row visual.
     - `Apply complete` info toast on the `never` reloadAfterApply
       path — the existing consolidated reload prompt is the
       meaningful action; the bare summary toast is noise.
     - `Enabled N managed extensions.` / `Disabled N managed
       extensions.` — same story, tree updates.
     - `<X> is already installed.` / `<X> is not installed.` —
       these are "you clicked a menu item that didn't apply"
       messages. Better: let the command be a no-op and log to the
       output channel. Keep a toast only if no side-effect-free
       feedback is possible from the tree context.
  3. Keep notifications for:
     - Any failure, partial failure, or skipped-but-user-should-
       know case (`updateFailed`, `installExtensionFailed`,
       `uninstallExtensionPartialCascade`, dep-check warn/fail
       rows, `refreshCatalogEmpty`).
     - Anything that needs the user to do something next
       (reload-after-apply prompt, "Open Settings" on missing
       vsixDirectory, "Uninstall / Cancel" modal cascades).
     - `withProgress` progress reporters — those are intentional
       and bounded; no change.
  4. Centralize the "is the user expected to see the tree result
     live?" decision in the callers, not the notify helper. The
     helper keeps doing what it does; we just call it less. Do NOT
     add a per-command `suppressSuccessToast` flag — that's a
     smell for the rule to become a toggle instead of a default.
  5. Update `CLAUDE.md` with the rule: "Default to no toast on
     success when the tree, Problems view, or status bar already
     reflects the outcome. Toasts are for action, error, or
     progress."

  Tests: for each call site we mute, assert the success path no
  longer calls `vscode.window.showInformationMessage`. Failure-path
  tests stay as-is. Dep commands gain a new test: "all checks pass
  → no toast" + "any check fails → warn toast with Show Dependencies
  action".

  Scope note: this is user-facing behavior, so ship it as one
  reviewable PR, not piecemeal. The risk is regressing the cases
  where a toast is load-bearing (e.g., an async command that
  genuinely has no visual side-effect) — the decision table in
  step 1 is what keeps us honest.

- [x] **"Open in Marketplace" button on extension-pack group rows.**
  The pack-discovery groups (`pack:<extensionId>`) and the two
  hardcoded pack built-ins (`salesforce-extension-pack`,
  `salesforce-extension-pack-expanded`) represent a real published
  extension — the pack itself — not just a set of members. Today the
  group row has no way to jump to that pack's marketplace page; the
  `$(link-external)` "Open in Marketplace" button only appears on
  leaf extension nodes. Users who want to read the pack description
  or leave a review have to remember the id and use the palette.

  Proposal: add an inline `view/item/context` button on pack-source
  group nodes that invokes the existing `sfdxManager.openInMarketplace`
  command with the pack's own extension id. Wiring details:
  - `Group.source === 'pack'` already marks pack-discovery groups;
    add a parallel marker for the two hardcoded pack built-ins so
    the contribution `when` clause can target all three. Either
    route them through `packGroups.ts` too (cleanest — discover
    from installed manifests + fall back to the hardcoded ids when
    not installed), or tag the hardcoded entries with a dedicated
    `contextValue` like `group:pack-builtin`.
  - Add the id the button should open to the group shape (e.g.,
    `Group.marketplaceExtensionId: string`), populated from
    `pack:<id>` or the hardcoded ids. The pack-discovery path
    already has it; the hardcoded entries need the string wired in.
  - `groupsTreeProvider.ts` sets `contextValue` to
    `group:pack` (or `:pack-builtin`) when `marketplaceExtensionId`
    is set; the `view/item/context` contribution in `package.json`
    targets that `contextValue` with the `$(link-external)` icon and
    the existing `sfdxManager.openInMarketplace` command, passing the
    group's `marketplaceExtensionId` via `arguments`. Reuse
    `extractExtensionId` in `updateCommands.ts` — it already accepts
    `{ extensionId }` shaped args, so no handler change is needed if
    the button passes the right shape.
  - `package.json` gets a new menu entry under
    `view/item/context`: `{ "when": "view == sfdxManager.groups &&
    viewItem =~ /^group:pack/", "group": "inline@1", "command":
    "sfdxManager.openInMarketplace" }` (or similar — inline position
    matches the leaf node's existing button).

  Tests: `groupsTreeProvider.test.ts` asserts pack groups receive
  the new contextValue and carry a `marketplaceExtensionId`;
  update `packGroups.test.ts` to confirm the field is populated.
  No new test for the handler itself — `openInMarketplace` is
  already covered in `updateCommands.test.ts`.

- [x] **Telemetry reporting** — add AppInsights-backed telemetry
  following the Agentforce Vibes pattern at
  `/Users/gbockus/github/AFV/salesforcedx-vscode-einstein-gpt/src/services/TelemetryService.ts`.
  AFV wires a `TelemetryService` singleton initialized via
  `CoreExtensionService.getTelemetryService()` and sends events
  (activation, command invocation, feature enablement, errors,
  feedback) to both AppInsights and a local file when local-
  telemetry mode is on.

  **Design question to resolve before coding:** how should the
  manager acquire a telemetry reporter *without* taking a runtime
  dependency on `salesforce.salesforcedx-vscode-core`? The manager
  must function when every other Salesforce extension is disabled
  — the "No `extensionDependencies` on self" rule from CLAUDE.md.
  A core dep breaks that invariant.

  **Candidate A — pull from `salesforcedx-vscode-services`.**
  Declare `salesforce.salesforcedx-vscode-services` as an
  `extensionDependencies` entry and grab a `TelemetryReporter`
  from its `.exports` at activation. Services is a small shared-
  runtime extension (not a feature extension), so this is more
  defensible than depending on core — but it still breaks the
  standalone-usable promise.

  **Candidate B — bring our own AppInsights reporter.** Use
  `@vscode/extension-telemetry` directly. Smaller blast radius,
  no cross-extension coupling. Cost: duplicated config
  (connection string, opt-out handling, local-file-dump flag).

  **Candidate C — soft dep on services.** Document services as
  recommended but not required. At activation,
  `getExtension('…services')?.exports` either returns a reporter
  or falls back to a no-op. Honest about optionality.

  **Recommendation to discuss:** start with C (optional services
  integration), add a setting
  `salesforcedx-vscode-manager.telemetryBackend`
  (`'services' | 'builtin' | 'disabled'`, default `'services'`
  with auto-fallback to `'builtin'` if services isn't present).

  **Events worth emitting (v0.1):** activation/deactivation
  (duration + version); `group.apply` (group.id, group.source,
  scope, result counts); `extension.install` / `.uninstall` /
  `.update` (extensionId + source); `catalog.refresh` (entry
  count + duration); `dependency.check` (pass/warn/fail counts);
  `error` (stack + command context). All events must honor
  VSCode's `telemetry.telemetryLevel` and never log PII
  (extension ids OK, group labels OK, file paths NOT).

  Test strategy: unit-test the reporter picker (services present
  vs absent vs `'disabled'`) against a mock
  `vscode.extensions.getExtension`; snapshot event payloads for
  shape + no-PII via a reporter spy.

  Gotcha: if A or C, `getExtension('...services').exports` needs
  the services extension to be activated first. Await
  `getExtension(id).activate()` during our activation with a
  short timeout. AFV does this — mirror it.

  Update `CLAUDE.md` once this lands so future agents don't
  reintroduce `extensionDependencies: ['...core']`.

- [ ] **Manage extension version dependencies** — let a Salesforce
  extension declare which version(s) of other extensions it's
  compatible with, and surface mismatches in the Groups tree with a
  visible indicator. VSCode's native `extensionDependencies` field is
  id-only (no semver range), and the marketplace has no version-pin
  concept either, so this has to be a custom property we read from
  each extension's `package.json` — same approach we used for
  `salesforceDependencies` (the external-prerequisite contract).

  ### Proposed contract

  A new top-level field in each extension's `package.json`, read
  statically (never activate the target):

  ```jsonc
  {
    "name": "salesforcedx-vscode-apex",
    "salesforceExtensionRequirements": [
      {
        "id": "salesforce.salesforcedx-vscode-core",
        "versionRange": ">=63.0.0",
        "severity": "error",
        "reason": "Relies on TelemetryService API added in 63.0.0."
      },
      {
        "id": "salesforce.salesforcedx-vscode-apex-log",
        "versionRange": ">=2.5.0 <3.0.0",
        "severity": "warn"
      }
    ]
  }
  ```

  Fields:
  - `id` (required) — target extension's `publisher.name`.
  - `versionRange` (required) — a semver range string
    (`^1.0.0` / `>=2.1.0 <3.0.0` / `~1.5.0`). Reuse `semver` library
    semantics; we already have an inline `compare` helper in
    `src/dependencies/versionCompare.ts` but should pull in the
    `semver` npm package for `satisfies()`.
  - `severity` (optional, default `'error'`) — `'error' | 'warn'`.
    Error = red badge + tree error color + never apply the group;
    warn = yellow badge + tree warning color + apply but surface.
  - `reason` (optional) — free-text blurb for the tooltip.

  ### Source of truth

  Each target extension's installed `package.json` (read via
  `ext.packageJSON` → fall back to disk scan for mid-session
  installs, same as `getDependencyGraph`). No central registry,
  no marketplace queries. A shim catalog at
  `src/dependencies/extensionRequirementsShims.ts` can seed
  requirements for Salesforce extensions that haven't adopted the
  contract yet — the same pattern the existing shim catalog uses.

  ### Engine

  New file: `src/services/extensionRequirementsService.ts`.
  - `collect(): ExtensionRequirement[]` — scans installed Salesforce
    extensions + the shim catalog, dedups by `(source, id)` so two
    extensions can pin the same target.
  - `evaluate(requirement, installedVersion): 'ok' | 'warn' | 'fail'`
    — wraps `semver.satisfies`; returns `ok` when the target isn't
    installed and severity is `warn` (nothing to pin yet), `fail`
    otherwise.
  - `violations(): Violation[]` — current list of requirements whose
    installed version fails the range, each carrying `sourceId`
    (extension that declared the requirement), `targetId`, the
    expected range, the observed version, severity, and reason.
  - In-memory cache invalidated by the same `clearCliVersionCache()`
    hook we already use — piggyback on extension-install events.

  ### UI

  **Groups tree (`GroupsTreeProvider`):**
  - Every `extension` node that's involved in a violation gains:
    - An inline warning/error icon on the row
      (`$(warning)` for warn, `$(error)` for fail).
    - A new description badge — `incompatible` for fail,
      `compatible (warn)` for warn.
    - Tooltip lines listing each violation: `Requires X vRange
      from <sourceDisplayName> — installed vObserved.`
  - New `contextValue` flags: `:reqFail` / `:reqWarn` so menus can
    target the state (e.g. a future "View Compatibility Details"
    command).

  **Dependencies tree:**
  - A new category: "Extension Compatibility" (alongside CLIs,
    Runtimes, Per-Extension). Each violation becomes a check row
    under it with the full source → target → range story. Reuses
    the existing status-icon + remediation-tooltip machinery.

  **Apply-time guard:**
  - `applyGroup` runs `violations()` before the install pass. Any
    `error`-severity violation where both source and target land in
    the effective enable set triggers a modal:
    > "Applying 'Apex' will activate extensions with incompatible
    > versions: `apex` requires `core >=63.0.0` but v62.1.4 is
    > installed. Continue?"
  - "Continue" proceeds with the apply as usual; "Cancel" aborts.
  - `warn` severity logs + appends to the apply-summary toast (which
    already fires for other "actionable" results), but never blocks.

  **Status bar:**
  - Existing `GroupStatusBarItem` gets an optional suffix — if
    `violations()` contains any `error` entries, the item's
    background flips to `statusBarItem.errorBackground` and the
    tooltip appends "N compatibility issue(s)". Click still opens
    the group picker; a separate `SFDX Manager: Show Compatibility
    Issues` command (focus Dependencies view) may be warranted.

  ### Commands

  - `sfdxManager.showCompatibilityIssues` — focuses the Dependencies
    view at the new category. Palette + view-title button.
  - Consider a `sfdxManager.copyCompatibilityReport` (mirrors
    `copyDependencyReport`) for bug reports.

  ### Settings

  One new enum setting:
  - `salesforcedx-vscode-manager.extensionCompatibility.onViolation`
    — `'block' | 'warn' | 'ignore'`, default `'warn'`. Lets
    organizations that don't want the manager to block apply turn
    error-severity into warnings.

  ### Telemetry

  New event: `sfdxManager_extension_requirements_check` with
  `{ total, ok, warn, fail }` counts. Fires on every
  `runDependencyCheck` + once per activation. Separate from
  `sfdxManager_dependency_check` so the dashboards stay clean.

  ### Tests

  - `semver` wrapper test (exact bounds, pre-release, caret / tilde /
    inclusive ranges).
  - `evaluate()` test covering ok / warn / fail / target-not-installed.
  - `applyGroup` regression: two members with a violation between
    them under `error` severity triggers the confirm prompt; user
    dismissing aborts; accepting continues. Under `warn` severity,
    no prompt.
  - `GroupsTreeProvider` test: a node with a violation gets the
    right contextValue flag + description badge + tooltip line.

  ### Reference

  - Existing `salesforceDependencies` contract implementation:
    `src/dependencies/registry.ts`, `src/dependencies/runners.ts`.
    Same read-statically pattern; the new engine is a sibling
    rather than a new concept.
  - AFV's `isAboveMinimumRequiredVersion` at
    `/Users/gbockus/github/AFV/salesforcedx-vscode-einstein-gpt/src/services/CoreExtensionService.ts:149-155`
    is a one-target variant of this idea — worth cribbing for the
    error-copy structure.
  - Adoption: once the contract lands, send a PR against
    `/Users/gbockus/github/IDEx/salesforcedx-vscode/packages/*/package.json`
    adding `salesforceExtensionRequirements` where appropriate. The
    shim catalog is the bridge until that adoption completes.

- [x] **In-progress spinner on the acting row + freeze the Groups
  panel until the action settles.** Today when a user triggers
  install / uninstall / update / apply on a row, the inline icon
  stays static and the rest of the panel remains clickable — users
  can fire a second action mid-flight and there's no clear signal
  which row is currently working. Proposed behavior:

  - Track a per-id "busy" set in the `GroupsTreeProvider` (or a new
    `BusyState` singleton so the status bar can subscribe too).
    Entering a handler (`installExtension`, `uninstallExtension`,
    `updateExtension`, `applyGroup`, `updateAll`, `enableAllManaged`,
    `disableAllManaged`, cascade-uninstall members) marks every
    affected id busy; the handler's `finally` clears them. For
    cascades mark each cascade member so the spinner lights up on
    every row in the chain.
  - Swap the row's `iconPath` to a `ThemeIcon('sync~spin')` while
    busy (codicon's built-in spin animation — same glyph the
    Extensions view uses). Override only the leaf `TreeItem.icon`;
    don't touch `contextValue`, so the existing menu machinery keeps
    working after the action settles.
  - Gate the whole Groups panel while *anything* is busy. Cheapest
    option: add an `isAnyBusy` context key
    (`vscode.commands.executeCommand('setContext',
    'sfdxManager.anyBusy', true)`) and append `&& !sfdxManager.anyBusy`
    to every `view/item/context`, `view/title`, and
    `commandPalette`-visible `when` clause in `package.json` that
    targets the Groups view. That hides the inline buttons, greys
    out the view-title buttons, and yanks the right-click actions
    without us having to intercept each command.
  - Status-bar group item and VSIX item should mirror the freeze —
    either disable their click handlers via the same context key or
    at least show the spinner codicon so the user sees the whole
    extension is mid-flight.
  - Edge cases: a handler that throws synchronously still needs to
    release the busy flag (wrap dispatch in a helper
    `withBusy(ids, fn)` that owns the try/finally). Reload-prompt
    responses should fire *after* busy clears so the tree isn't
    frozen underneath the prompt.
  - Tests: unit-test the `BusyState` transitions (enter/exit, nested
    overlaps, throw-in-handler releases). Integration is manual F5
    — add a checklist row under `docs/notification-verification.md`
    ("Row spinner + panel freeze during install / cascade / apply").

  Nice-to-have follow-ups: `Escape` cancels the current op where
  possible (e.g., abort `code --install-extension` via the
  `ProcessService` handle), and a subtle status-bar "N operations
  running" indicator when multiple rows are in flight.

  **Shipped** — `src/util/busyState.ts` is the refcounted busy
  registry and context-key broadcaster (`sfdxManager.anyBusy`). Every
  mutating command (`installExtension`, `uninstallExtension` cascade,
  `updateExtension`, `updateAllSalesforce`, `applyGroup`,
  `enableAllSalesforce`, `disableAllSalesforce`,
  `browseSalesforceExtensions` install phase,
  `refreshFromVsixDirectory`) now wraps its work in `busy.withBusy(ids,
  fn)` via a per-file `withBusy` helper. The Groups tree provider
  subscribes to `busy.onChange` and swaps icons to
  `ThemeIcon('sync~spin')` for any busy extension id or the
  `__group_apply__:<id>` sentinel. Both status-bar items prefix their
  text with `$(sync~spin)` when anything's in flight. Every
  `view/title` and `view/item/context` entry targeting
  `sfdxManager.groups` now appends `&& !sfdxManager.anyBusy`, so
  inline buttons / context menu items / view-title buttons disappear
  while an op runs. 262 → 275 tests; new `busyState.test.ts` (7
  cases) plus spinner + cascade-busy assertions added to the existing
  tree-provider and update-commands suites.

- [x] **Replace VSCode's "no data provider registered" placeholder
  with friendly copy.** On a cold VSCode start the Groups and
  Dependencies views briefly render VSCode's built-in message
  *"There is no data provider registered that can provide view
  data."* during the activation gap between the view being declared
  in `package.json` and our `registerTreeDataProvider` call. We
  activate on `onStartupFinished`, so the window is usually
  sub-second but still visible — and on a very slow machine it can
  linger.

  Fix via a `contributes.viewsWelcome` entry in `package.json` —
  same mechanism the VSCode SCM/Run views use for their empty-state
  copy. VSCode renders the welcome content whenever the view has
  no children to display (including before the provider registers).
  Concretely:

  ```jsonc
  "contributes": {
    "viewsWelcome": [
      {
        "view": "sfdxManager.groups",
        "contents": "%salesforcedx-vscode-manager.viewsWelcome.groups%"
      },
      {
        "view": "sfdxManager.dependencies",
        "contents": "%salesforcedx-vscode-manager.viewsWelcome.dependencies%"
      }
    ]
  }
  ```

  The `%key%` placeholders route through `package.nls.json` per the
  externalized-strings rule; suggested copy for the Groups view:

  > Loading Salesforce Extension Manager…
  >
  > This view lets you apply extension groups, install / update /
  > uninstall individual extensions, and browse the Salesforce
  > publisher catalog.
  >
  > [Refresh](command:sfdxManager.applyGroupQuickPick)

  Dependencies welcome copy should invite the user to run the
  dependency check (link `command:sfdxManager.runDependencyCheck`).

  Welcome content markdown supports `[label](command:<id>)` links,
  so the empty state can double as a first-run affordance on
  machines where no managed extensions are installed yet.

  Tests: a `viewsWelcome` unit (read `package.json`, assert both
  views have a welcome entry whose `contents` uses a localization
  key). Manual F5: reload with no managed extensions installed;
  confirm the welcome copy renders instead of the default message.

  Low-risk follow-up: once the welcome covers the cold-start gap,
  consider moving `activationEvents` from `onStartupFinished` to
  `onView:sfdxManager.groups` so we don't activate until the user
  opens the view. That trades startup time for first-click
  latency; leave the decision for a profiling pass.

  **Shipped** — `contributes.viewsWelcome` in `package.json` now
  declares welcome entries for both `sfdxManager.groups` and
  `sfdxManager.dependencies`, with markdown copy sourced from two
  new `package.nls.json` keys
  (`salesforcedx-vscode-manager.viewsWelcome.groups` /
  `.dependencies`). The welcome is intentionally button-free —
  purely descriptive text — so it doesn't crowd the real tree
  rows once they load. New `test/unit/viewsWelcome.test.ts` (3
  cases) asserts every view has a welcome entry, every welcome
  contents field is an `%nls-key%` that resolves, and the copy is
  plain text (no `command:` links). 275 → 278 tests. Followup on
  switching `activationEvents` to `onView:*` stays open.

- [x] **Prefix-based VSIX override matching.** Today
  `parseVsixFilename` in `src/vsix/vsixScanner.ts` only accepts
  files that match the strict `<publisher>.<name>-<version>.vsix`
  shape `vsce package` emits. Internal / CI builds often drop the
  publisher and use a renamed artifact — e.g.
  `salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix` — and those
  currently fail to parse at all, so the override is silently
  skipped. User intent when dropping an oddly-named VSIX in the
  override directory is *"match this to the extension whose id
  starts similarly"*; we should honor that.

  Proposed behavior:

  1. Keep the existing strict parser as the fast path (still the
     vendored / marketplace-emitted shape).
  2. When the strict parser fails, fall back to a fuzzy match that:
     - strips the trailing `-<version>.vsix`,
     - normalizes the prefix (lowercase, `_` → `-`),
     - compares against the set of ids `ExtensionService.managed()`
       reports, resolving to the **longest** managed id whose `.name`
       portion (id minus publisher prefix) is a prefix of the
       filename stem. Example matches:
       - `salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix` →
         `salesforce.salesforcedx-einstein-gpt`
       - `salesforcedx-vscode-apex-63.1.0.vsix` →
         `salesforce.salesforcedx-vscode-apex`
       - `salesforcedx-vscode-apex-replay-debugger-63.1.0.vsix` →
         `salesforce.salesforcedx-vscode-apex-replay-debugger`
         (longest-prefix wins over `salesforce.salesforcedx-vscode-apex`)
     - falls back to `undefined` if nothing matches (current
       behavior).
  3. `VsixScanner.scan()` needs the managed-id catalog to resolve
     fuzzy matches. Options:
     a. Inject a lookup hook (`setManagedIdLookup: () => string[]`)
        — same pattern as `setCatalogDisplayNameLookup` in
        `ExtensionService`. Keeps the scanner side-effect-free.
     b. Pass the id list into `scan(managedIds)` on each call. Less
        coupling, but every caller (watcher, installer, commands)
        has to pass it through.
     Option (a) is the lighter-touch choice. Wire it in
     `extension.ts` after `ExtensionService` is constructed.
  4. When a fuzzy match fires, log a one-line info: `vsix:
     matched '<filename>' to '<id>' via prefix.` so users can
     spot an unintended match in the output channel. If two
     managed ids tie on prefix length (rare — would require a
     managed id that's also a strict prefix of another managed
     id), log a warning and pick the first by sort order; the
     user can rename the VSIX to disambiguate.
  5. Status-bar + groups-tree VSIX badges already key off the
     resolved extension id, so they light up automatically once
     the scanner returns the mapped id.

  Tests: extend `vsixScanner.test.ts` with cases for the
  real-world examples above (match, no-match on nonsense names,
  longest-prefix wins, unchanged behavior when the strict parser
  still matches). Keep the existing strict-parser tests as the
  fast-path regression.

  Docs: `README.md` VSIX section + the Phase-8 walkthrough step
  need a line documenting the relaxed matching rule. `CHANGELOG`
  bullet.

  Out of scope: matching against ids that aren't `managed()`.
  The override directory is opt-in for the user's *Salesforce*
  workflow — dropping a random third-party VSIX in there and
  expecting it to override some unrelated installed extension
  would be surprising. If/when that use case surfaces, extend
  the lookup to fall back to `vscode.extensions.all` ids.

  **Shipped** — new `parseVsixFilenameFuzzy(filename, managedIds)`
  in `src/vsix/vsixScanner.ts` does the longest-prefix resolution
  with a `stem[name.length] in {'-', '.', ''}` boundary guard
  (so `apex` doesn't match `apexoas`). `VsixOverride` gained an
  optional `matchedBy: 'strict' | 'prefix'` tag; `VsixInstaller.
  tryInstall` logs `vsix: matched '<file>' to '<id>' via prefix.`
  when the fuzzy path fires. Wired through `scanner.
  setManagedIdLookup(() => extensions.managed().map(e => e.id))`
  in `extension.ts` (both on first construction and in the
  `vsixDirectory`-change rebuild block). Filenames without a
  trailing version get a `0.0.0` sentinel so downstream install
  still works; install uses the filepath, not the parsed version.
  278 → 287 tests (+9). Matching against non-`managed()` ids
  stays out of scope per the note above.
