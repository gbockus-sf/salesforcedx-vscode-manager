# Changelog

All notable changes to `salesforcedx-vscode-manager` will be documented in this file.

## [Unreleased]

- Groups tree now shows each extension's installed version, an `$(arrow-circle-up)` update badge when the marketplace has a newer build, and a `$(package)` badge (with a VSIX-walkthrough tooltip hint) when the extension came from the local VSIX override directory. New commands `SFDX Manager: Update Extension` (inline, per node) and `SFDX Manager: Update All Salesforce Extensions` (view-title) route through `code --install-extension --force`. Marketplace discovery is gated behind the new `salesforcedx-vscode-manager.updateCheck` setting (`onStartup` / `manual` / `never`, default `manual`) and caches results for 1 hour in memory.
- Activity-bar icon swapped from a padlock to a stacked-layers glyph matching the status-bar `$(layers)` icon.
- Apply-group now skips an install attempt when the marketplace probe can confirm the id isn't published (e.g., `salesforce.lightning-design-system-vscode`); offline machines still attempt the install as before. Probe result cached 1 h per id.
- Empty user groups can no longer be saved — `Create Custom Group` and `Edit Group` now surface an error before writing.
- Removed the dead `salesforcedx-vscode-manager.useInternalCommands` setting. It had no runtime effect under the `codeCli` backend.

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
