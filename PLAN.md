# salesforcedx-vscode-manager — Implementation Plan

> **This document is the source of truth for the build.** The very first implementation step copies this file into the new repo as `PLAN.md`. From that point on, the in-repo `PLAN.md` is the authoritative, version-controlled tracker — every phase below has checkboxes that get marked as work lands, and the file travels with the PR history.

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
- [ ] `src/commands/dependencyCommands.ts` — show, runCheck, copyReport
- [ ] `src/views/dependenciesTreeProvider.ts` with category grouping + status icons + remediation tooltip
- [ ] Manual F5 smoke: render with healthy env, then break `java` and re-check

### Phase 8 — VSIX override
- [ ] `src/vsix/types.ts`
- [ ] `src/vsix/vsixScanner.ts` — scan, filename parser (`<publisher>.<name>-<version>.vsix`), `FileSystemWatcher`
- [ ] `src/vsix/vsixInstaller.ts` — `tryInstall()` routes to `code --install-extension <path> --force` when match found, otherwise marketplace id; records provenance in `workspaceStateService`
- [ ] Rewire `ExtensionService.install()` to consult `VsixInstaller` first
- [ ] `src/commands/vsixCommands.ts` — `refreshFromVsixDirectory`, `openVsixDirectory`, `clearVsixOverrides`, `vsixMenu`
- [ ] Groups tree labels gain `$(package)` + tooltip for VSIX-sourced extensions
- [ ] `vsixScanner.test.ts`, `vsixInstaller.test.ts`
- [ ] Manual F5 smoke: populate a folder with one real VSIX, set the setting, apply a group that includes it, verify provenance + tooltip

### Phase 9 — Status bar
- [ ] `src/statusBar/groupStatusBarItem.ts` — reads active group from workspace state, click → `applyGroupQuickPick`
- [ ] `src/statusBar/vsixStatusBarItem.ts` — visible only when `vsixDirectory` set; count + warning background; click → `vsixMenu`
- [ ] Respect `statusBar.showGroup` / `statusBar.showVsix` toggles
- [ ] Update on: group apply, VSIX install, setting change, FS watcher event
- [ ] Manual F5 smoke: switch groups, observe both items update live

### Phase 10 — Polish
- [ ] `contributes.walkthroughs` with 4 steps (group, deps, vsix, status bar)
- [ ] README: user guide + `salesforceDependencies` contract spec + VSIX workflow section
- [ ] CHANGELOG 0.1.0 entry
- [ ] `npx @vscode/vsce package` produces a clean `.vsix`
- [ ] Install into a fresh VSCode, run through §7 verification list

### Phase 11 (nice-to-have v0.1.1)
- [ ] Import / export group JSON
- [ ] Workspace-scoped override of `groups` setting
- [ ] Per-group "Open in Quick Pick" keybinding

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
