# Salesforce Extensions Manager — Highlights

**Salesforce Extensions Manager** is a new VSCode extension for developers on the Salesforce Platform. One place to:

- **Switch toolchains** — one click to flip between Apex, Lightning, React, either Salesforce Extension Pack, or a custom group. Transitive dependencies handled automatically; no more "Cannot uninstall" blockers.
- **See every Salesforce extension** — the full Marketplace catalog under the `salesforce` publisher, one right-click away from install, with a Browse Quick Pick for discovery.
- **Verify prerequisites** — Salesforce CLI, Java, Node, Git, all color-coded with remediation links. Extensions can declare their own prerequisites through a new `salesforceDependencies` contract.
- **Swap in unreleased VSIX builds** — point a setting at a folder of `.vsix` files and the manager uses them instead of Marketplace versions, with clear visual indicators so you know when you're off production builds.
- **Stay out of the way** — native VSCode UI (no webviews), every action has a Command Palette entry, every string is externalized for translation.

Pre-release, open-source, BSD-3-Clause. Grab the `.vsix`, press F5, and check the **Get Started with the Salesforce Extensions Manager** walkthrough.

For the full announcement see [`announcement.md`](./announcement.md).
