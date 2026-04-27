# Salesforce Extensions Manager — Highlights

**Salesforce Extensions Manager** is a VSCode extension for developers on the Salesforce Platform. One place to:

- **Switch toolchains** — one click to flip between Apex, Lightning, React, either Salesforce Extension Pack, Anypoint, or a custom group. Transitive dependencies handled automatically; cascaded uninstalls ordered topologically; a consolidated reload prompt replaces VSCode's per-extension banners.
- **See every Salesforce extension** — the full Marketplace catalog under the `salesforce` publisher, one right-click away from install, with a Browse Quick Pick for discovery.
- **Verify prerequisites, automatically** — Salesforce CLI, Java, Node, Git, all color-coded with remediation links. Dep check auto-runs after every group apply so missing prerequisites surface before users try to use the extensions. Individual extensions can declare their own prerequisites through the `salesforceDependencies` contract.
- **Know when your CLI is stale** — the manager reads `sf version`'s own update warning and surfaces it as a status-bar nudge + Dependencies-tree badge. Click once to run `sf update` in a dedicated terminal; indicators clear automatically on close.
- **Swap in unreleased VSIX builds, authoritatively** — point a setting at a folder of `.vsix` files and the manager auto-installs them, locks the Groups-row actions for matched extensions, and shows every override in a dedicated activity-bar view. Filename matching is forgiving: strict `<publisher>.<name>-<version>.vsix` shape works, but CI-renamed artifacts also resolve via longest-prefix matching against known extension ids.
- **Stay out of the way** — native VSCode UI (no webviews), row-level spinners during in-flight operations with the rest of the panel frozen to prevent double-clicks, sticky notifications that only fire when there's an action / error / progress to report, every string externalized for translation.

Pre-release, open-source, BSD-3-Clause. Grab the `.vsix`, press F5, and check the **Get Started with the Salesforce Extensions Manager** walkthrough.

For the full announcement see [`announcement.md`](./announcement.md).
