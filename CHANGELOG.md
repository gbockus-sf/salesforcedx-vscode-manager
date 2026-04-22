# Changelog

All notable changes to `salesforcedx-vscode-manager` will be documented in this file.

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
