# Smoke tests

Manual F5 checks that only a human can run. Work through these any time
you want confidence the extension is wired up end-to-end — before a
release, after a gnarly merge, or whenever the automated suite feels
insufficient. Each row is a checkbox so you can track progress.

Many of the toast-level expectations live in `notification-verification.md`
instead — this doc focuses on the functional wiring: **does the feature
actually do what it claims?**

## Prereqs

- [ ] Repo is clean (`git status` shows no modified files besides this doc).
- [ ] `npm install && npm run compile && npm run lint && npm test` all pass.
- [ ] VSCode is up to date (`code --version`).

## Launch

- [ ] F5 from the repo root opens an Extension Host window.
- [ ] Activity bar shows the SFDX Manager icon; clicking it reveals the
  **Groups** and **Dependencies** views.
- [ ] `SFDX Manager: Show Log` opens the output channel with
  `Salesforce Extensions Manager activated.` on the first line.
- [ ] No error toasts on activation in the Host window.

---

## Phase 7 — Dependencies

Goal: dependency tree renders real state, and breaking a dep flips the
row without restart.

### Healthy-environment render

- [ ] `SFDX Manager: Show Dependencies` focuses the Dependencies view.
- [ ] The tree renders at least these rows: `sf` (Salesforce CLI),
  `java` / Java JDK, `node` / Node.js, `git`.
- [ ] Each row shows a `$(check)` icon when the dep is present; the
  installed version appears in the description.
- [ ] If `autoRunDependencyChecks` is unset, rows start as "not run yet"
  until you run the check.

### Break `java`

In the terminal that launched the Extension Host:

- [ ] `export PATH=$(echo $PATH | tr ':' '\n' | grep -v -i 'java\|jdk\|zulu' | paste -sd: -)` so `java` is no longer resolvable. Verify with `which java` → nothing.
- [ ] From the Host window palette: **SFDX Manager: Run Dependency Check**.
- [ ] Java row flips to `$(error)` / `fail`.
- [ ] Row's tooltip surfaces the remediation text / URL from the shim.
- [ ] Warn toast appears: `Dependencies: 3 ok · 1 fail` (or similar)
  with a `Show Dependencies` action button.
- [ ] Click `Show Dependencies` → Dependencies view gets focus.
- [ ] Right-click Java row → inline `$(link-external)` remediation button
  opens the Adoptium (or configured) URL in the browser.

### Static manifest read (no activation)

- [ ] Pick any disabled Salesforce extension that declares
  `salesforceDependencies` in its `package.json`. Reload the Host.
- [ ] Its declared dep appears in the Dependencies tree even though
  the extension is disabled. (Confirms manager reads `packageJSON`
  without activating the target.)

### Cleanup

- [ ] Restore `PATH` or close the terminal. Re-run the check → Java row
  returns to `$(check)` / `ok`.

---

## Phase 8 — VSIX override

Goal: a `.vsix` in the configured directory wins over the marketplace,
with provenance tracked + tooltip proving it.

### Setup

- [ ] Create a scratch directory, e.g. `~/tmp/sfdx-vsix/`.
- [ ] Download one real Salesforce `.vsix` (e.g. from CI artifacts or
  `npx @vscode/vsce package` of a local clone). Filename must follow
  `<publisher>.<name>-<version>.vsix`.
- [ ] In the Host window: **Preferences: Open Settings (UI)**, set
  `salesforcedx-vscode-manager.vsixDirectory` to the absolute path.
- [ ] Output channel: no warning about a missing directory.

### Apply a group that pulls the VSIX

- [ ] Apply a built-in group that includes the extension your `.vsix`
  covers (e.g. `Apex` for `salesforcedx-vscode-apex`).
- [ ] Reload when prompted.
- [ ] The extension's row in the Groups tree shows the `$(package)`
  badge and a tooltip reading
  `Installed from local VSIX: <filename>`.
- [ ] Output log has a line like `install(<id>): vsix.`
- [ ] Workspace state records the provenance: reload the Host again,
  the `$(package)` badge persists (proving `installSource: 'vsix'`
  survived reload).

### Refresh + clear

- [ ] **SFDX Manager: Refresh from VSIX Directory** (palette or the
  VSIX Management... menu).
- [ ] Progress toast appears; everything that has a matching `.vsix`
  reinstalls. Silent on clean success (per the notification rule).
- [ ] **SFDX Manager: Clear VSIX Overrides** → confirm modal → the
  `$(package)` badges disappear, tree rows revert to marketplace
  provenance, status-bar VSIX item hides.

### Directory-missing warning

- [ ] Set `vsixDirectory` to a path that doesn't exist, reload the Host.
- [ ] Warn toast at startup: `VSIX directory "<path>" does not exist.`
  with an `Open Settings` button. Click it → Settings opens to that key.

### FS watcher

- [ ] Restore `vsixDirectory` to the real directory. Copy a second
  `.vsix` into it.
- [ ] Groups tree refreshes (via the FileSystemWatcher) without any
  manual command — the new row's badge should appear within a second
  or so of the copy.

### Cleanup

- [ ] Clear `vsixDirectory` in settings. Reload. Status-bar VSIX item
  stays hidden, tree rows show no `$(package)` badges.

---

## Phase 9 — Status bar

Goal: both status-bar items live-update as state changes.

### Group indicator

- [ ] On a fresh Host with no applied group, the left-side status bar
  shows `$(layers) None`. Tooltip reads "No SFDX group applied —
  click to pick one".
- [ ] Click it → `Apply Group...` Quick Pick opens.
- [ ] Pick `Apex`. After the apply settles, the status-bar text flips
  to `$(layers) Apex`. Tooltip updates to "Active SFDX group: Apex".
- [ ] Pick `Lightning` (via the status-bar click again, not palette).
  Status bar flips to `$(layers) Lightning` immediately after apply.

### VSIX indicator

- [ ] With `vsixDirectory` unset, the VSIX status-bar item is **not**
  visible.
- [ ] Set `vsixDirectory` and populate it with a matching `.vsix`,
  apply a group that pulls it. The status bar gains
  `$(package) VSIX: N` (N = count of VSIX-sourced extensions) with a
  warning-colored background.
- [ ] Click the VSIX item → VSIX Management Quick Pick opens.
- [ ] **SFDX Manager: Clear VSIX Overrides** → confirm → VSIX status
  bar item disappears (count hits zero + hidden).

### Visibility toggles

- [ ] Turn off `salesforcedx-vscode-manager.statusBar.showGroup`. Group
  status bar item disappears.
- [ ] Turn off `salesforcedx-vscode-manager.statusBar.showVsix`. VSIX
  item stays hidden even when overrides become active.
- [ ] Re-enable both settings. Both items return.

---

## Phase 10 — Package + fresh-profile install

Goal: the packaged `.vsix` installs into a cold VSCode profile and
activates cleanly.

### Package

- [ ] `npx @vscode/vsce package --baseContentUrl https://github.com/
  --baseImagesUrl https://github.com/ --out /tmp/sfdx-manager.vsix`
  completes.
- [ ] Output reports `(~19 files, ~49 KB)` (within a few KB is fine;
  document any drift).

### Fresh profile

- [ ] `code --user-data-dir /tmp/sfdx-manager-fresh-profile --install-extension
  /tmp/sfdx-manager.vsix` succeeds.
- [ ] `code --user-data-dir /tmp/sfdx-manager-fresh-profile .` launches
  a clean window with the extension installed.
- [ ] Activity bar has the SFDX Manager icon.
- [ ] Groups view lists the built-in groups (Apex, Lightning, React,
  Salesforce Extension Pack, Salesforce Extension Pack (Expanded),
  Anypoint Extension Pack).
- [ ] Dependencies view renders.
- [ ] No red error toasts at activation. Output channel has the
  `activated.` line.
- [ ] `Developer: Startup Performance` → activation time for
  `salesforce.salesforcedx-vscode-manager` is **under 500 ms**.
- [ ] Walkthrough: **Get Started with the Salesforce Extensions
  Manager** renders the four steps (group, deps, vsix, status bar)
  and each CTA button works.

### Cleanup

- [ ] `rm -rf /tmp/sfdx-manager-fresh-profile` when done so you
  don't reuse a polluted profile next time.

---

## Phase 11 — Import / export round trip

Goal: exports produce a portable file; imports round-trip without
losing data.

- [ ] Create two custom user groups via **Create Custom Group**.
- [ ] **SFDX Manager: Export Groups...** → save to
  `/tmp/sfdx-manager-groups.json`.
- [ ] Open the JSON, confirm it has `version: 1` and the two groups.
- [ ] Delete both user groups from settings (or just delete them
  through the tree).
- [ ] **SFDX Manager: Import Groups...** → pick the JSON.
- [ ] Both groups come back in the tree with the same members.
- [ ] Edit one imported group, then import the file again. Confirm
  you get a conflict modal (Overwrite / Skip / Skip All).

---

## Phase 12 — Telemetry + locked extensions

Goal: verify telemetry lights up through core's reporter, respects the
per-extension opt-out, and that `salesforcedx-vscode-core` + services
show up in the tree as "required, not actionable".

### Setup

- [ ] In the F5 Host window, install `salesforce.salesforcedx-vscode-core`
  from the marketplace if it isn't already present. (Reloading the
  manager extension should pull it in automatically via
  `extensionDependencies`.) Services comes along for the ride.
- [ ] Open the extension output channel.

### Activation telemetry

- [ ] Reload the window. Output channel shows `TelemetryService:
  acquired core telemetry reporter.` near the top.
- [ ] Activation completes with no red toasts.

### Event emission

- [ ] Apply a group (e.g. `Apex`). Output log shows the apply
  summary; telemetry fires `sfdxManager_group_apply` with counts.
- [ ] Install / update / uninstall any non-locked managed extension.
  Telemetry fires `sfdxManager_extension_install` / `_update` /
  `_uninstall` with the id and `exitCode: 0`.
- [ ] `SFDX Manager: Refresh Salesforce Catalog`. Telemetry fires
  `sfdxManager_catalog_refresh` with the entry count and duration.
- [ ] `SFDX Manager: Run Dependency Check`. Telemetry fires
  `sfdxManager_dependency_check` with ok/warn/fail/unknown counts.

*How to inspect telemetry events during dev:* if
`salesforce.isDebugLoggingEnabled` (or whatever core calls it) is on,
AppInsights events get dumped to the debug console. Otherwise, trust
the flow unless you want to set up a local AppInsights sink.

### Opt-out

The manager no longer has its own telemetry kill switch — the shared
telemetry service from `@salesforce/vscode-service-provider` handles
the gate. To exercise the disabled path, flip VSCode's global
`telemetry.telemetryLevel` to `off` and repeat any of the actions
above; the manager's typed helpers stop firing because the shared
reporter drops events.

### Locked extensions

- [ ] Expand the Apex group (or any group containing
  `salesforce.salesforcedx-vscode-core`). The core row shows a
  `required` badge in the description and a "Required by Salesforce
  Extensions Manager" line in the tooltip.
- [ ] Right-click the core row → **no** `Install Extension` /
  `Uninstall Extension` entries in the context menu. `Update
  Extension` and `Open in Marketplace` are still there.
- [ ] Palette: `SFDX Manager: Uninstall Extension` is hidden (per
  package.json's `commandPalette` gate). To test defense-in-depth,
  dispatch programmatically (or through a compromised workflow) —
  the handler early-returns with a sticky info toast
  "Cannot uninstall Salesforce Extensions CLI Integration — required
  by Salesforce Extensions Manager."
- [ ] Apply a group that would normally try to disable core under
  `disableOthers` scope (e.g. a group that doesn't list core as a
  member). The apply summary shows `disabled: N` **without** core in
  the list; output log is clean (no "Cannot uninstall" lines).
- [ ] `SFDX Manager: Disable All Managed Extensions` → core and
  services stay installed.

### Cleanup

- [ ] Restore VSCode's `telemetry.telemetryLevel` to its previous
  value. Re-apply your preferred group.

---

## Cross-cutting — compile/lint/test gates

Keep this at the bottom so it's the last thing you confirm before a
release:

- [ ] `npm run compile` — zero TS errors.
- [ ] `npm run lint` — zero warnings.
- [ ] `npm test` — all passing; note the test count here and
  compare against the previous run (regression signal).
- [ ] `npx @vscode/vsce package ...` — clean, no `vsce` warnings that
  weren't present before.

## Notes field

Write down anything surprising you noticed while going through the
drill. If a row fails, capture the output-channel log line
verbatim — that's the fastest path to a fix.

```
Date:
Commit:
VSCode version:
Notes:
```
