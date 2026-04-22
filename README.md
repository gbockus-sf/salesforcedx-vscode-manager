# Salesforce Extensions Manager

A VSCode extension for managing which Salesforce VSCode extensions are active
in your workspace, verifying external prerequisites, and running
unreleased VSIX builds without leaving the marketplace install for
production.

## Features

### Extension groups

Named sets of extensions you can flip between from the Command Palette,
the Groups tree view, or the status bar.

- Built-ins: **Apex**, **Lightning**, **React** *(empty stub — edit to fill)*.
- Create custom groups via `SFDX Manager: Create Custom Group`.
- Edit or delete groups (deleting a built-in resets it to defaults).
- Apply scope is user-configurable: enable-only, or enable-members +
  uninstall-others.

### Dependency validation

A Dependencies tree in the activity bar that verifies external
prerequisites for the extensions you have installed — Salesforce CLI,
Java, Node, etc.

Driven by a new declarative contract: each extension can add a top-level
`salesforceDependencies` array to its `package.json`. The manager reads it
statically (no activation required), so disabled extensions still declare
their needs. A shim catalog fills in known checks for extensions that
haven't adopted the contract yet.

See the "Verify dependencies" walkthrough step for the full schema.

### Local VSIX override directory

Set `salesforcedx-vscode-manager.vsixDirectory` to a folder of `.vsix` files
(named `<publisher>.<name>-<version>.vsix`) and the manager will install
those local builds in place of the marketplace version. Perfect for
testing unreleased extensions against a real workspace.

Install provenance (`vsix` vs `marketplace`) is tracked per extension.
The Groups tree and the status bar both surface which extensions are
currently running from a local VSIX.

### Status bar

Two items on the left side:

- **Active group** (`$(layers) Apex`) — click to switch.
- **VSIX count** (`$(package) VSIX: 3`) — visible only when the VSIX
  directory is configured; click for the management menu.

## Commands

All commands live under the `SFDX Manager:` category in the palette.

| Command | What it does |
|---|---|
| Apply Group... | Pick a group to apply |
| Create Custom Group | Walk through id, label, and member selection |
| Edit Group / Delete Group | Modify or reset a group |
| Enable All Managed Extensions | Install every managed extension |
| Disable All Managed Extensions | Uninstall every managed extension |
| Open Groups Setting | Jump to the groups entry in settings.json |
| Show Dependencies | Focus the Dependencies tree |
| Run Dependency Check | Re-run every registered check |
| Copy Dependency Report | Markdown report to clipboard |
| Refresh from VSIX Directory | Reinstall every managed extension from local VSIX |
| Open VSIX Directory | Open the folder in the OS file manager |
| Clear VSIX Overrides | Uninstall vsix-sourced, reinstall from marketplace |
| VSIX Management... | Central Quick Pick for the vsix commands |
| Show Log | Open the extension's output channel |

## Settings

| Setting | Default | Description |
|---|---|---|
| `salesforcedx-vscode-manager.groups` | `{}` | User-defined groups (merged with built-ins by id) |
| `salesforcedx-vscode-manager.applyScope` | `disableOthers` | `disableOthers` / `enableOnly` / `ask` |
| `salesforcedx-vscode-manager.backend` | `codeCli` | Reserved for a future Profiles backend |
| `salesforcedx-vscode-manager.autoRunDependencyChecks` | `false` | Run checks on activation |
| `salesforcedx-vscode-manager.thirdPartyExtensionIds` | *(see package.json)* | Non-Salesforce extensions the manager may toggle |
| `salesforcedx-vscode-manager.vsixDirectory` | `""` | Directory of local `.vsix` files |
| `salesforcedx-vscode-manager.statusBar.showGroup` | `true` | Show group in status bar |
| `salesforcedx-vscode-manager.statusBar.showVsix` | `true` | Show VSIX count in status bar |

## Declaring dependencies in your Salesforce extension

Add a top-level `salesforceDependencies` array to your `package.json`:

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

Supported `check.type` values:

- `exec` — run a command and parse its version (`versionRegex` optional,
  `minVersion` optional).
- `env` — check an environment variable; supports a nested `fallback`
  check for when the env var is unset.
- `file` — check a path exists (`${HOME}` / `${workspaceFolder}` / leading `~` are expanded).
- `nodeVersion` — compare against `process.versions.node`.
- `extensionInstalled` — `vscode.extensions.getExtension(extensionId)`.

## Status

Pre-release. See [`PLAN.md`](./PLAN.md) for phase progress and open TODOs.

## License

BSD-3-Clause — see [LICENSE.txt](./LICENSE.txt).
