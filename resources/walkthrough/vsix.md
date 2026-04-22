# Use a local VSIX directory

Set `salesforcedx-vscode-manager.vsixDirectory` to a folder of `.vsix` files
and the manager will install those local builds **instead of** the
marketplace version.

## Filename convention

`<publisher>.<name>-<version>.vsix` (the default output of `vsce package`).

Examples:
- `salesforce.salesforcedx-vscode-apex-63.1.0.vsix`
- `redhat.vscode-xml-0.26.0.vsix`

## What happens

- Applying a group that includes an extension with a matching VSIX runs
  `code --install-extension <path> --force`.
- If no matching VSIX is found, the manager falls through to the
  marketplace install (`code --install-extension <id>`).
- Install provenance is tracked per extension; the tree and status bar
  reflect it.

## Commands

- `SFDX Manager: Refresh from VSIX Directory` — reinstall every managed
  extension from its matching VSIX.
- `SFDX Manager: Open VSIX Directory` — open the folder in your OS file
  manager.
- `SFDX Manager: Clear VSIX Overrides` — uninstall everything flagged as
  VSIX-sourced and reinstall from the marketplace.
- `SFDX Manager: VSIX Management...` — single Quick Pick that combines
  all of the above.
