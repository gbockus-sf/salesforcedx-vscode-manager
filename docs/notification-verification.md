# Notification sanity-check drill

A go-down-the-list walkthrough against the F5 Extension Host. Each row:
action → expected user-visible feedback. **"Silent"** means no toast —
the tree / status bar / output log is the evidence.

Default rule (from `CLAUDE.md`): notifications fire only when there's
an **action** to take, an **error**, or **progress** to report. Everything
else logs to the output channel.

## Quick setup

- [x] Launch the F5 Extension Host.
- [x] Open the Salesforce Extensions Manager view.
- [x] Open the extension output channel (`SFDX Manager: Show Log`).
- [x] Keep both visible so you can confirm "silent" paths actually logged.

---

## 1. Groups — per-extension lifecycle

- [x] **Install a missing extension.** Right-click any uninstalled row → **Install Extension**.
  _Expected:_ progress → **silent**. Row flips to `installed`. Log: `install(<id>): marketplace.`
- [x] **Install an already-installed extension.** Right-click an installed row → **Install Extension**.
  _Expected:_ **silent**. Log: `install(<id>): already installed; nothing to do.`
  No option to install if already installed. 
- [x] **Update an extension.** Right-click an installed row with an update badge → **Update Extension**.
  _Expected:_ progress → **silent**. Version badge updates. Log: `update(<id>): reinstalled with --force.`
- [x] **Cancel an uninstall modal.** Right-click an installed row → **Uninstall Extension** → dismiss.
  _Expected:_ **silent**, nothing changes.
- [x] **Uninstall a leaf extension.** Right-click a row without dependents → **Uninstall Extension** → confirm.
  _Expected:_ modal "Uninstall X?" → **silent**. Row flips to `not installed`.
- [ ] **Cascade uninstall.** Right-click `Apex` (with OAS + Replay Debugger installed) → **Uninstall Extension** → confirm.
  _Expected:_ modal lists dependents by display name → **silent**. All three rows flip.
- [ ] **Cancel a cascade.** Same setup, dismiss the modal.
  _Expected:_ **silent**, no changes.
- [ ] **Uninstall a not-installed extension.** Pick any uninstalled row → **Uninstall Extension**.
  _Expected:_ **silent**. Log: `uninstall(<id>): not installed; nothing to do.`
- [ ] **Open in Marketplace from a leaf row.** Right-click any extension row → **Open in Marketplace**.
  _Expected:_ Extensions-view opens on that extension. No toast.
- [ ] **Open in Marketplace from a pack row.** Right-click `Salesforce Extension Pack` or `Anypoint Extension Pack` → **Open in Marketplace**.
  _Expected:_ Extensions-view opens on the pack itself. No toast.

### Failure verification

- [ ] **Install failure.** Disconnect Wi-Fi, right-click an uninstalled row → **Install Extension**.
  _Expected:_ red error toast naming the extension (display name) + `Dismiss` button. Output log has the stderr.

---

## 2. Groups — bulk + apply

- [ ] **Apply a clean group.** Click `Apex` → **Apply Group** → pick a scope.
  _Expected:_ progress → tree rows flip → **reload prompt** if anything was touched (the one info toast we kept — it's an action). If you dismiss, silent.
- [ ] **Re-apply the same group.** Apply `Apex` again immediately.
  _Expected:_ progress → no changes → no reload prompt → **silent**.
- [ ] **Apply with dep-blocked state.** Apply a group where a disable would strand a dependent.
  _Expected:_ **warn toast** summarizing `depBlocked: N` / `Skipped: N` / `Manual disable: N` with a `Show Log` action.
- [ ] **Apply the catalog group.** Right-click `All Salesforce Extensions` → **Apply Group**.
  _Expected:_ **warn toast** — catalog is too big to apply.
- [ ] **Enable All Managed Extensions.** From palette.
  _Expected:_ progress → **silent**. Tree rows flip to installed/enabled.
- [ ] **Disable All Managed Extensions.** From palette.
  _Expected:_ progress → **silent**. Tree and status-bar group indicator update.
- [ ] **Update All (healthy network).** From palette.
  _Expected:_ progress bar → **info toast** `Update complete: N succeeded.` (kept — no per-row visual).
- [ ] **Update All with failures.** Disconnect network, then run.
  _Expected:_ **warn toast** `Update complete: N succeeded · M failed.` with `Show Log`.
- [ ] **Update All with zero managed extensions.**
  _Expected:_ **info toast** `No managed extensions to update.`

---

## 3. Groups — CRUD + scope

- [ ] **Create a custom group.** Palette → **Create Custom Group** → id/label/members.
  _Expected:_ **silent**. New tree node appears.
- [ ] **Edit a user group.** Right-click a user group → **Edit Group** → change members.
  _Expected:_ **silent**. Tree refreshes.
- [ ] **Delete a user group.** Right-click → **Delete Group** → confirm modal.
  _Expected:_ modal → **silent** after confirm. Tree node gone.
- [ ] **Reset a built-in group.** Right-click a built-in → **Delete Group** → confirm.
  _Expected:_ **silent**. Reverts to defaults.
- [ ] **Move group scope.** Right-click a user group → **Move Group to User/Workspace** → pick the other scope.
  _Expected:_ **silent**. Tree badge flips `user` ↔ `workspace`.
- [ ] **Move scope on a built-in.** Same action on a built-in group.
  _Expected:_ **error toast** "Built-in groups cannot be moved…"
- [ ] **Export empty.** **Export Groups...** with zero user groups.
  _Expected:_ **info toast** "No user-defined groups to export." (kept — save dialog would produce nothing).
- [ ] **Export with content.** **Export Groups...** with user groups → pick a file.
  _Expected:_ **info toast** "Exported N group(s) to /path/..." (kept — no tree visual for a written file).
- [ ] **Import invalid JSON.** **Import Groups...** → pick a malformed file.
  _Expected:_ **error toast** "Import failed: ..."
- [ ] **Import with conflicts.** **Import Groups...** → pick a file whose ids exist.
  _Expected:_ modal per conflict → **info toast** summarizing imported/skipped counts.

---

## 4. Dependencies

- [ ] **All-green dep check.** **Run Dependency Check** when everything is healthy.
  _Expected:_ tree rows all turn green/`$(check)` → **silent**. Log: `Dependency check complete: 4 ok`.
- [ ] **Dep check with a failure.** Break `java` (e.g. `export PATH=<…without Java>` in the launch terminal) → **Run Dependency Check**.
  _Expected:_ **warn toast** `Dependencies: 3 ok · 1 fail` with a **Show Dependencies** button. Click it → Dependencies view focuses.
- [ ] **Copy dependency report.** **Copy Dependency Report** from palette.
  _Expected:_ **silent**. Clipboard has the markdown report. Log: `Dependency report copied to clipboard (N chars).`
- [ ] **Remediation link.** Click a dependency row's inline `$(link-external)` remediation button.
  _Expected:_ external URL opens in browser. No toast.

---

## 5. Catalog + Browse

- [ ] **Refresh catalog (online).** **Refresh Salesforce Catalog** from palette.
  _Expected:_ progress on the catalog group → **silent**. Catalog group member count updates. Log: `publisherCatalog: refreshed; N extensions.`
- [ ] **Refresh catalog offline.** Disconnect network → **Refresh Salesforce Catalog**.
  _Expected:_ **warn toast** `Salesforce catalog refresh returned no results (offline?).`
- [ ] **Browse install.** **Browse Salesforce Extensions...** (catalog loaded) → pick 2 extensions → install.
  _Expected:_ progress toast with display names → **silent** on success. Tree rows flip to installed.
- [ ] **Browse install with failures.** Same, with network flaky.
  _Expected:_ **warn toast** `Installed N · M failed. See log.`
- [ ] **Browse empty catalog.** **Browse Salesforce Extensions...** before any refresh.
  _Expected:_ **info toast** `Salesforce catalog is empty — run Refresh...` (kept — user-initiated, no result).

---

## 6. Check for Updates

- [ ] **Check for Extension Updates.** From palette.
  _Expected:_ network refresh → **silent**. Any extensions with newer versions get the `$(arrow-circle-up)` badge. Log: `checkForUpdates: tree refreshed via MarketplaceVersionService.`
- [ ] **Native modal is gone.** Confirm VSCode's native "All extensions are up to date." modal does **not** pop.

---

## 7. VSIX

- [ ] **VSIX Management... (unset).** Palette → **VSIX Management...** with `vsixDirectory` unset.
  _Expected:_ Quick Pick. Pick "Configure VSIX Directory" → Settings opens.
- [ ] **Refresh without a directory.** **Refresh from VSIX Directory** with no directory set.
  _Expected:_ **warn toast** with `Open Settings` button.
- [ ] **Refresh empty dir.** Set `vsixDirectory` to an empty folder → **Refresh from VSIX Directory**.
  _Expected:_ **info toast** `No .vsix files found in <dir>.` (kept — user-initiated, empty result).
- [ ] **Refresh populated dir.** Drop one real `.vsix` in the folder → **Refresh from VSIX Directory**.
  _Expected:_ progress → **silent** on success. Tree rows for that extension get `$(package)` badges + VSIX tooltip. Log: `vsixRefresh: reinstalled 1 from VSIX directory.`
- [ ] **Clear with nothing to clear.** **Clear VSIX Overrides** with no overrides.
  _Expected:_ **info toast** `No VSIX-sourced extensions to clear.`
- [ ] **Clear with overrides.** **Clear VSIX Overrides** with overrides present → confirm modal.
  _Expected:_ modal → **silent**. Tree badges disappear, status-bar VSIX item hides.
- [ ] **Missing directory warning.** Set `vsixDirectory` to a non-existent path → reload window.
  _Expected:_ **warn toast** at activation with `Open Settings` button.

---

## 8. Status bar + activation

- [ ] **Group status bar click.** Apply a group, click the `$(layers) <group>` status-bar item.
  _Expected:_ group picker Quick Pick opens. No extra toast.
- [ ] **VSIX status bar click.** With VSIX overrides active, click the `$(package) VSIX: N` status-bar item.
  _Expected:_ VSIX management Quick Pick opens.
- [ ] **Activation quiet.** Reload window.
  _Expected:_ **silent**. No toasts during startup. Output channel shows `Salesforce Extensions Manager activated.`

---

## 9. Regression canaries — should NEVER appear

These toasts were explicitly removed. If any show up, it's a bug:

- [ ] `Dependencies: 4 ok` (all-green)
- [ ] `Installed <extension>.`
- [ ] `Updated <extension>.`
- [ ] `Uninstalled <extension>.` (including the cascade variant)
- [ ] `<extension> is already installed.`
- [ ] `<extension> is not installed.`
- [ ] `Enabled N managed extensions.`
- [ ] `Disabled N managed extensions.`
- [ ] `Group "X" created with N extensions.`
- [ ] `Group "X" updated.`
- [ ] `X: deleted.` / `X: reset to default.`
- [ ] `X moved to workspace scope.` / `X moved to user scope.`
- [ ] `SFDX Manager: update check complete.`
- [ ] `Salesforce catalog: N extensions cached.`
- [ ] `Dependency report copied to clipboard.`
- [ ] `Refreshed from VSIX directory: N installed.`
- [ ] `Reinstalled N extension(s) from marketplace.`
- [ ] `<group> applied.` on a clean apply (reload prompt is OK).
- [ ] VSCode's native `All extensions are up to date.` modal.

---

## 10. Final smoke

- [ ] Walked the list; nothing from §9 appeared.
- [ ] Every "silent" action left a log line in the output channel.
- [ ] Every warn / error toast had an action button (no auto-dismiss).
- [ ] Every modal (uninstall cascade, delete group, vsix-clear, reload-after-apply, import conflicts) blocked until the user picked.

If any row misbehaves, the log line from the output channel is the
fastest diagnostic — share it with the maintainer and they can trace
it.
