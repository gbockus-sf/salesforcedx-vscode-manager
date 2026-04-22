# Salesforce Extensions Manager

A VSCode extension for managing which Salesforce VSCode extensions are active in your workspace.

## What it does (v0.1 target)

- **Groups** — switch between named sets of Salesforce extensions (Apex, Lightning, React, custom) from the Command Palette, a tree view, or the status bar.
- **Dependencies** — a tree view that verifies external prerequisites (Salesforce CLI, Java JDK, Node, etc.) for the Salesforce extensions you have installed, with remediation hints.
- **VSIX override directory** — point a setting at a folder of `.vsix` files and the manager will install those local builds in place of the marketplace versions, for testing unreleased extensions.
- **Status bar** — two indicators showing the active group and whether the workspace is loading any extensions from local VSIX.

See [PLAN.md](./PLAN.md) for the full implementation plan and trackable checklist.

## Status

Pre-release. Phase 0 bootstrap complete. See `PLAN.md` for phase progress.

## License

BSD-3-Clause — see [LICENSE.txt](./LICENSE.txt).
