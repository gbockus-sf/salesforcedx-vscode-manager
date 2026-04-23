# Salesforce Extensions Manager

Switch between curated sets of Salesforce VSCode extensions for the
task at hand, verify your external prerequisites, and test unreleased
builds against a real workspace — all from a single activity-bar view.

## Overview

The Salesforce Extensions Manager is a companion to the [Salesforce
Extensions for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=salesforce.salesforcedx-vscode)
pack. Salesforce ships around two dozen first-party extensions, and
most developers only need a subset active at any one time — Apex
today, Lightning tomorrow, a lightweight "just the CLI" loadout
while reviewing a pull request. Keeping every extension enabled all
the time slows VSCode activation and clutters menus with features
you aren't using.

The manager adds three things on top of the extension pack:

1. **Extension groups** — named sets you can apply with one click,
   shipped built-ins for Apex / Lightning / React plus dynamic groups
   for every Salesforce-published extension pack.
2. **A Dependencies tree** — live status of the external
   prerequisites your Salesforce extensions need (Salesforce CLI,
   Java, Node, Git), with one-click remediation links.
3. **A VSIX override directory** — point the manager at a folder of
   local `.vsix` files and they take priority over the marketplace
   version on install.

<!-- TODO: add overview GIF showing the activity bar, Groups tree, and a group-apply flow. -->

## Prerequisites

Before installing the manager, make sure you have:

- **[Visual Studio Code](https://code.visualstudio.com/download)**
  version 1.90 or later.
- **[Salesforce Extensions for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=salesforce.salesforcedx-vscode)**
  and its prerequisites (Salesforce CLI, a Salesforce DX project,
  JDK 11+). The manager declares `salesforcedx-vscode-core` as an
  `extensionDependencies` entry, so installing the manager
  force-installs the core extension automatically.

## What can the Extensions Manager do?

### Switch between extension sets

Apply a group and the manager flips the installed / enabled state of
every managed extension to match — optionally uninstalling anything
not in the group to keep your editor lean. Ships with built-in groups
for **Apex**, **Lightning**, and **React**, plus dynamic groups for
the **Salesforce Extension Pack**, the **Expanded** pack, and the
**Anypoint Extension Pack**. Create your own with **SFDX Manager:
Create Custom Group**, or pick from every Salesforce-published
extension via **Browse Salesforce Extensions...**.

<!-- TODO: GIF showing the Groups tree, applying Apex, then applying Lightning — rows flip state. -->

### Verify your development prerequisites

The **Dependencies** tree in the activity bar lives-checks the
external prerequisites each installed Salesforce extension needs —
Salesforce CLI, Java, Node, Git, etc. Rows turn green when happy;
red/yellow rows surface a remediation tooltip and a one-click link
to the fix (Adoptium downloads, nvm, CLI setup guide).

Extension authors can declare their own prerequisites via a top-level
`salesforceDependencies` field in `package.json`; see the
[extension-author contracts](./docs/extension-author-contracts.md)
doc.

<!-- TODO: screenshot of the Dependencies tree with a mix of green + failing rows. -->

### Test unreleased builds with local VSIX

Set `salesforcedx-vscode-manager.vsixDirectory` to a folder of
`.vsix` files (named `<publisher>.<name>-<version>.vsix`) and those
local builds take priority over the marketplace version at install
time. The Groups tree tags every VSIX-sourced extension with a
`$(package)` badge so you can tell at a glance which rows are
running a local build.

Useful for QA engineers, release testing, and pre-release developer
previews — no more manually juggling `code --install-extension` for
a dozen `.vsix` files.

<!-- TODO: screenshot of the Groups tree with a row showing the $(package) VSIX badge + tooltip. -->

## Documentation

- [Apply a group walkthrough](./resources/walkthrough/apply-group.md)
- [Verify dependencies walkthrough](./resources/walkthrough/dependencies.md)
- [VSIX override walkthrough](./resources/walkthrough/vsix.md)
- [Status bar indicators](./resources/walkthrough/status-bar.md)
- [Contracts for extension authors](./docs/extension-author-contracts.md)
- [Telemetry event catalog](./docs/telemetry-events.md)
- [Notification catalog](./docs/notifications.md)

## Telemetry

The manager emits a small set of events through the shared
`salesforcedx-vscode-core` telemetry pipeline — the same one every
Salesforce extension uses — so maintainers can see activation
counts, group applies, and error rates. **No PII is transmitted:**
payloads carry extension ids, group ids, durations, and exit codes
only. File paths, workspace names, and user identifiers are never
sent.

The global VSCode `telemetry.telemetryLevel` setting gates everything
downstream. To opt out of just manager events while leaving VSCode
telemetry on, set
`salesforcedx-vscode-manager.telemetry.enabled` to `false`.

Full event list: [`docs/telemetry-events.md`](./docs/telemetry-events.md).

## Bugs and Feedback

To report issues with the Salesforce Extensions Manager, open a
[bug on GitHub](https://github.com/forcedotcom/salesforcedx-vscode-manager/issues/new?template=Bug_report.md).
If you'd like to suggest a feature, create a
[feature request on GitHub](https://github.com/forcedotcom/salesforcedx-vscode-manager/issues/new?template=Feature_request.md).

## Open Source

- [GitHub Repository](https://github.com/forcedotcom/salesforcedx-vscode-manager)
- License: BSD-3-Clause — see [LICENSE.txt](./LICENSE.txt).

<!-- TODO: add the SHA verification boilerplate once the extension is signed and published. -->
