# Changelog

All notable changes to `salesforcedx-vscode-manager` will be documented in this file.

## [Unreleased]

- **VSIX overrides now resolve oddly-named files via longest-prefix match.** The strict `<publisher>.<name>-<version>.vsix` parser still wins; when it fails (e.g. a CI-renamed artifact like `salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix`), the scanner walks the list of managed extension ids and maps the file to whichever id's `name` portion is the longest prefix of the filename stem. Boundary-guarded so `salesforcedx-vscode-apex` doesn't spuriously match `salesforcedx-vscode-apex-oas-...`. Each prefix-resolved override logs `vsix: matched '<file>' to '<id>' via prefix.` to the output channel so an unintended match is discoverable.
- **Friendly welcome copy for the Groups and Dependencies views on cold start.** Replaces VSCode's built-in *"There is no data provider registered that can provide view data."* message with localized descriptive copy for each view. Intentionally button-free so the welcome doesn't crowd the real tree rows once they load.
- **Apply-group summary toast is now `info`, not `warn`.** Apply itself runs to completion even when it reports `dependencyBlocked` / `needsManualEnable` / `needsManualDisable` / `skipped` entries — those are informational follow-ups, not failures, and the warning-triangle icon was misleading. Individual install / update failures continue to fire their own error toasts.
- **Row spinner + Groups-panel freeze during in-flight actions.** Install, uninstall (including every cascade member), update, apply-group, update-all, enable/disable-all, catalog browse-install, and VSIX refresh now swap the acting row's icon to `$(sync~spin)` for the duration of the op. Meanwhile the whole Groups panel locks down: inline buttons, right-click context menu items, and view-title buttons all disappear until the op settles, so double-clicks can't fire a second action mid-flight. Both status-bar items prefix their text with `$(sync~spin)` while anything's in flight. Driven by a new `BusyState` refcount registry that also broadcasts the `sfdxManager.anyBusy` VSCode context key for the menu `when` clauses.
- **Cascade uninstall no longer drags in extension packs or errors on already-removed ids.** `transitiveDependents` walks `extensionDependencies` only — pack membership is a listing relationship, not a runtime dependency, so uninstalling `Apex` no longer tries to uninstall `Salesforce Extension Pack` and fail with a confusing "not installed" error. Additionally, `ExtensionService.uninstall` now treats the CLI's "Extension X is not installed." stderr as a no-op success so cascade callers don't flag lagged-snapshot re-entries as partial failures.
- Groups tree now shows each extension's installed version, an `$(arrow-circle-up)` update badge when the marketplace has a newer build, and a `$(package)` badge (with a VSIX-walkthrough tooltip hint) when the extension came from the local VSIX override directory. New commands `SFDX Manager: Update Extension` (inline, per node) and `SFDX Manager: Update All Salesforce Extensions` (view-title) route through `code --install-extension --force`. Marketplace discovery is gated behind the new `salesforcedx-vscode-manager.updateCheck` setting (`onStartup` / `manual` / `never`, default `manual`) and caches results for 1 hour in memory.
- Activity-bar icon swapped from a padlock to a stacked-layers glyph matching the status-bar `$(layers)` icon.
- Apply-group now skips an install attempt when the marketplace probe can confirm the id isn't published (e.g., `salesforce.lightning-design-system-vscode`); offline machines still attempt the install as before. Probe result cached 1 h per id.
- Empty user groups can no longer be saved — `Create Custom Group` and `Edit Group` now surface an error before writing.
- Removed the dead `salesforcedx-vscode-manager.useInternalCommands` setting. It had no runtime effect under the `codeCli` backend.
- **Apply-group now understands VSCode's extension-dependency graph.** Transitive `extensionDependencies` of group members are auto-included in the effective enable set (and labeled in the summary as "Dep auto-included: N"). Non-member uninstalls are skipped when another installed extension still depends on them, replacing VSCode's per-uninstall "Cannot uninstall X" warnings with structured `dependencyBlocked` state surfaced in the log.
- **Topological uninstall order** — `disableOthers` now removes extensions in an order where dependents (and containing packs) come off before their dependencies (and pack members), avoiding the dependency-chain blockage we saw during the v0.1 smoke tests.
- **Consolidated reload prompt after apply** — new setting `salesforcedx-vscode-manager.reloadAfterApply` (`auto` / `prompt` / `never`, default `prompt`). Replaces VSCode's one-banner-per-uninstall with a single opt-in prompt after the whole apply completes.
- **Groups tree extension nodes expand to show their `extensionDependencies` and `extensionPack` members** as read-only children with `$(link)` and `$(package)` icons. Helps users understand why a disable got blocked and what gets pulled in when enabling.
- **All user-facing strings externalized.** `package.json` now uses `%key%` placeholders resolved by `package.nls.json`; source strings route through a new `src/localization/` module (`LocalizationKeys` enum + `localizationValues` map + `getLocalization()` helper wrapping `vscode.l10n.t`). Adding translations only requires dropping a `package.nls.<locale>.json` + `l10n/bundle.l10n.<locale>.json` pair — no code changes. New `npm run l10n` script wraps `@vscode/l10n-dev export`. A unit test asserts every `LocalizationKeys` entry has a non-empty default.
- **Import / export groups.** Two new commands (`SFDX Manager: Export Groups...` / `Import Groups...`) serialize user-defined groups to a versioned JSON file and reload them back, with per-id conflict prompts (Overwrite / Skip / Skip All). Built-ins aren't exported — they travel in code.
- **Workspace-scoped groups.** `SettingsService.getGroupsByScope()` now surfaces the user and workspace layers separately; `GroupStore.upsert/remove/moveToScope` route to the right `ConfigurationTarget`. New `SFDX Manager: Move Group to User / Workspace...` command. Groups tree shows a `user` / `workspace` badge next to each user-defined group so the scope is visible at a glance.
- **Keybinding:** `Cmd+Alt+G` (macOS) / `Ctrl+Alt+G` fires `sfdxManager.applyGroupQuickPick` for fast group switching.
- **`SFDX Manager: Check for Extension Updates` now also triggers VSCode's native `workbench.extensions.action.checkForUpdates`** so users see the familiar Extensions-view Update badges alongside the manager's arrow indicators. Our marketplace probe remains the structured source.
- **Extension packs surface as groups.** Every installed Salesforce-published extension whose `package.json` declares an `extensionPack` now appears as a read-only group in the tree (id `pack:<extensionId>`, label from the pack's `displayName`, tagged with an `extension pack` badge and a `$(package)` icon). Apply uses the pack's own member list, so a freshly-installed `salesforce.salesforcedx-vscode` gives you a one-click "Apex + Lightning + LWC + …" group without any configuration. Delete / Edit / Move-scope are hidden for pack groups — the pack's manifest is the source of truth.
- **Salesforce marketplace catalog integration.** The VSCode Marketplace gallery API is now queried for every extension published under the `salesforce` publisher:
  - A new **"All Salesforce Extensions"** group (id `catalog:salesforce`, `$(cloud)` icon, `marketplace catalog` badge) surfaces the full catalog as a read-only group. Applying it installs everything Salesforce ships, even extensions the user hasn't heard of.
  - New command **`SFDX Manager: Browse Salesforce Extensions...`** (view-title `$(cloud)` button) opens a multi-select Quick Pick of the catalog with description + install-count, so users can discover and install specific extensions without leaving VSCode. Selections are installed via the existing `code --install-extension` pipeline.
  - New command **`SFDX Manager: Refresh Salesforce Catalog`** triggers a cached network probe on demand. Catalog refresh honors the existing `updateCheck` setting (`onStartup` auto-refreshes at activation; `manual` / `never` wait for the command).
  - All network work is offline-safe: when the marketplace is unreachable the catalog is simply empty and the UI degrades gracefully. Results are cached in-memory for 1 hour.

## [0.1.0] — Unreleased

Initial release.

### Groups
- Built-in groups for Apex, Lightning, and an empty React stub.
- Custom groups: create, edit, delete (built-ins revert to defaults on delete).
- Apply scope setting: `disableOthers` / `enableOnly` / `ask` (prompts with per-group memory).
- Apply via Command Palette, activity-bar tree, or status bar.

### Dependencies
- Activity-bar tree grouped by category (CLIs, Runtimes, Per-Extension).
- Declarative `salesforceDependencies` contract (top-level in each extension's `package.json`), read statically — works for disabled extensions.
- Fallback shim catalog for extensions that haven't adopted the contract.
- Check types: `exec`, `env`, `file`, `nodeVersion`, `extensionInstalled`.
- Commands: Show, Run, Copy Report.
- Dedupe by logical-check fingerprint: declarations pointing at the same underlying prerequisite (e.g., `JAVA_HOME`) fold into a single row whose tooltip lists every contributing extension.

### VSIX override
- `salesforcedx-vscode-manager.vsixDirectory` setting.
- On apply, a matching `<publisher>.<name>-<version>.vsix` is installed in place of the marketplace version (`code --install-extension --force`).
- Install provenance tracked per extension; Groups tree and status bar surface VSIX-sourced extensions.
- Commands: Refresh, Open, Clear Overrides, VSIX Management menu.
- FileSystemWatcher on the directory; tree refreshes on add/remove/change.

### Status bar
- Left-aligned group indicator (click to switch).
- Left-aligned VSIX count indicator with warning background when active.
- Toggleable via settings.

### Backend
- `code` CLI for install/uninstall (persistent). VSCode exposes no public API
  to toggle extension enablement by id, so apply-group uses install/uninstall.
- VSCode Profiles backend reserved for a future release.

### Developer experience
- `SFDX Manager: Show Log` opens the Output channel with full diagnostic
  context for any apply or dependency run.
- Walkthrough with four steps (apply group, dependencies, VSIX, status bar).
