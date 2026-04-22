# Status bar indicators

Two items on the left side of the status bar:

- **$(layers) Apex** — the currently applied group. Click to switch.
- **$(package) VSIX: 3** — how many managed extensions are currently
  installed from the local VSIX directory. Visible only when the VSIX
  setting is configured. Warning background when the count is > 0 so
  you don't forget you're running non-production builds. Click for the
  VSIX management menu.

## Toggles

- `salesforcedx-vscode-manager.statusBar.showGroup` — show/hide the group item.
- `salesforcedx-vscode-manager.statusBar.showVsix` — show/hide the VSIX item.
