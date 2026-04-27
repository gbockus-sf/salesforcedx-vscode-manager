# Salesforce Extensions Manager — v0.1 Announcement

**Introducing the Salesforce Extensions Manager for VSCode.**

If you develop on the Salesforce Platform from VSCode, you already live in a large and growing extension ecosystem — the core Apex tooling, Lightning, LWC, SOQL, Visualforce, the Agentforce Vibes AI assistant, SLDS, Code Analyzer, and more than twenty other first-party extensions. Each is great at its job, but together they create four recurring pain points we kept seeing on the team:

1. You rarely need everything active at once. An Apex-heavy workday loads Lightning tooling you're not using; an LWC day leaves the Apex debugger idling in the background.
2. External prerequisites — the `sf` CLI, Java, Node — are invisible until something fails, and each extension invents its own "is Java installed?" check.
3. QA and extension developers who need to run unreleased `.vsix` builds have no clean way to swap them in against a Salesforce-published baseline.
4. Discovering everything Salesforce publishes on the Marketplace is a manual job.

**Salesforce Extensions Manager** tackles all four. It's a standalone VSCode extension (`salesforce.salesforcedx-vscode-manager`) that lives quietly on your activity bar — a stacked-layers icon — and unfolds into up to three tree views (Groups, VSIX Overrides, Dependencies) plus a small status-bar footprint.

## Groups: one-click control of your active toolchain

The **Groups** view lets you switch between named sets of extensions:

- **Handcrafted built-ins** for the three most common workflows: Apex, Lightning, and a React group populated with Vibes, Live Preview, and Metadata Visualizer for JS-heavy work.
- **Salesforce Extension Pack** and **Salesforce Extension Pack (Expanded)** — both shipped as built-in groups with the exact member lists from the pack manifests, so you can apply either one even if the pack itself isn't installed yet. When the pack *is* installed, the manager upgrades the entry to use the pack's live manifest so member changes flow through automatically.
- **Anypoint Extension Pack** also ships as a built-in group.
- **Custom groups** you define yourself — create, edit, delete, import, export, even move between user and workspace scope so a group can be workspace-specific when it needs to be.
- **Auto-discovered pack groups** — any Salesforce-published extension whose `package.json` declares an `extensionPack` surfaces as a read-only group with a `$(package)` badge.

Applying a group installs every member via the `code` CLI and, optionally, uninstalls non-members so your workspace is left with exactly the tools the group calls for. The manager understands VSCode's dependency graph, so it auto-includes transitive `extensionDependencies`, refuses to uninstall something another installed extension still depends on (no more "Cannot uninstall — X depends on this" banners), and orders uninstalls topologically so extension packs come off before their members. Cascade uninstalls correctly ignore pack-membership edges — uninstalling `Apex` no longer drags in the Salesforce Extension Pack row and fails with a confusing "not installed" error.

A single "Apply complete — reload window?" prompt replaces VSCode's one-banner-per-uninstall, and you can switch to auto-reload if you prefer. The same consolidated prompt fires after single install / uninstall / update operations, not just apply. Locked extensions — the manager's own runtime dependencies like `salesforcedx-vscode-core` — show a `required` badge and have their install / uninstall actions hidden so you can't brick the tool while using it.

Every extension node in the tree also exposes per-extension Install, Uninstall, Update, and **Open in Marketplace** buttons, plus inline update badges when newer versions are published — you never have to edit a group definition just to trim one thing out of it.

### Feels right when you click it

When you trigger an action on a row, you see it happen. The acting row's icon flips to a spinner for the duration of the op; for cascades, every row in the chain spins simultaneously. The rest of the Groups panel freezes (inline buttons, right-click menu items, view-title buttons all disappear) so a fast second click can't fire a competing operation. Both status-bar items prefix their text with `$(sync~spin)` while anything's in flight. Notifications stay out of the way: the default is silent on success when the tree already reflects the outcome, with sticky toasts reserved for genuine errors, partial failures, or follow-ups the tree can't show. Toasts that do fire reference extensions by their display name ("Agentforce Vibes"), not their raw publisher-qualified id.

## All Salesforce Extensions, straight from the Marketplace

The manager queries the VSCode Marketplace Gallery API for every extension published under the `salesforce` publisher and surfaces the whole catalog as a read-only group, with install counts and short descriptions. Because the catalog is too large to apply as a single group, the Apply button is replaced with:

- Per-extension Install / Uninstall buttons directly on each node, and
- **`SFDX Manager: Browse Salesforce Extensions...`** — a multi-select Quick Pick for discovering and installing specific extensions without leaving VSCode.

The catalog refreshes on a schedule you control via the `updateCheck` setting (once-per-session by default) and stays fully offline-safe: when the Marketplace is unreachable, the group quietly prompts for a refresh rather than erroring.

## Dependencies: know your prerequisites before they break you

A separate Dependencies view shows every external prerequisite the extensions in your workspace actually need — the Salesforce CLI, Java 11+, Node, Git, and more — with color-coded pass/warn/fail icons, remediation hints, and a one-click "copy markdown report" command for bug reports.

The view earns its keep two ways. First, a **contract**: any Salesforce extension can declare its prerequisites as a top-level `salesforceDependencies` array in its own `package.json`, with five check types (`exec`, `env`, `file`, `nodeVersion`, `extensionInstalled`). The manager reads this statically — no extension activation required — so even a disabled extension contributes to the tree. For extensions that haven't adopted the contract yet, a built-in shim catalog fills the gap (Apex already gets the Java JDK check). A logical-check deduplication pass means if four extensions all depend on the same JDK, you see one row, not four.

Second, **automation**: the dep check now runs automatically after every group apply that touched state. Users get early visibility into missing prerequisites before they try to use the freshly-enabled extensions. No-op re-applies skip the check to avoid a probe tax; clean checks stay silent; warn/fail cases surface a summary toast with a "Show Dependencies" shortcut.

### Salesforce CLI update indicator

When your installed `sf` is behind the latest release, the Dependencies view flags it. The manager parses the warning line `sf version` prints on stderr when its own self-update detector has a pending upgrade — no parallel channel-URL probe, no npm registry call, we just ask the CLI and read what it already knew. Three coordinated surfaces light up when an update is pending:

- The Salesforce CLI row shows `$(arrow-circle-up)` + `update → v<latest>` and a tooltip with the upgrade command hint.
- A new status-bar indicator appears (left side), clickable to upgrade.
- An inline `$(arrow-circle-up)` button on the row and a `SFDX Manager: Upgrade Salesforce CLI` palette command both open a dedicated terminal named "Salesforce CLI Update" and run `sf update`.

When you close that terminal after watching the upgrade finish, the manager automatically flushes its cached state and re-runs the CLI dep check, so the indicator clears without a reload. A `SFDX Manager: Refresh Salesforce CLI Version` palette command handles the "I upgraded from my own shell" case. Status-bar visibility is controlled by the `statusBar.showCliUpdate` setting (default on).

## VSIX override directory — authoritative, not advisory

Point `salesforcedx-vscode-manager.vsixDirectory` at a folder of local `.vsix` files and the manager treats that directory as the source of truth for the matching extensions:

- **Auto-install at activation and on every file change.** Drop a new `.vsix` in the folder and it installs immediately (idempotent: files already at the matching version are skipped). Remove a file and it stays installed but is no longer VSIX-managed.
- **Groups-view lockdown.** Matching rows show a `vsix-managed` badge; their Install / Uninstall / Update actions disappear so you can't accidentally drift from the override set.
- **Dedicated VSIX Overrides view.** A third activity-bar view appears alongside Groups and Dependencies when at least one `.vsix` is present, listing every override file with inline Reveal and Remove actions.
- **Forgiving filename matching.** Strict `<publisher>.<name>-<version>.vsix` is the fast path. When that fails — CI-renamed artifacts like `salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix`, files without a publisher prefix — the scanner falls back to longest-prefix matching against the full set of ids the manager knows about (installed, group members, catalog). Matches are boundary-guarded so `apex` can't be mistaken for `apex-oas`. Every prefix-resolved override logs the mapping for auditability.
- **"VSIX available" signal before install.** If you drop a VSIX for an extension you haven't installed yet, the corresponding Groups row shows `not installed · vsix available` and the tooltip names the waiting file so you know which local build will land on install.

The override indicator in the status bar (warning-colored, showing override count) and the VSIX Overrides view both track the directory via a `FileSystemWatcher`, so everything stays in sync as files come and go. The `vsixAutoInstall` setting (default on) is the kill switch for the auto-install behavior.

## Status bar and keybinding

Three left-aligned status-bar items: the currently-applied group, the VSIX-override count (when active, warning-colored), and — when pending — the Salesforce CLI update indicator. Each is clickable, each can be individually hidden via its own `statusBar.show*` setting. A global **⌘/Ctrl + Alt + G** keybinding fires the group Quick Pick for fast switching.

## Settings

Everything is configurable, and Settings grouping makes it searchable. The manager's settings render in five logical subsections under Extensions → Salesforce Extensions Manager: **Groups** (apply scope, reload behavior, allowed third-party ids), **VSIX Overrides** (directory, auto-install), **Dependencies** (auto-run), **Marketplace** (update check schedule), **Status Bar** (three visibility toggles). Telemetry enablement is delegated entirely to the shared Salesforce telemetry service — the manager honors whichever gate the service decides, no duplicate per-extension kill switch.

## Discoverability on cold start

Friendly copy replaces VSCode's built-in "There is no data provider registered that can provide view data." empty-state message on both the Groups and Dependencies views (and the VSIX Overrides view when no overrides are present). The copy is intentionally button-free descriptive text — it doesn't crowd the real rows once they load.

## Built to be localized

Every user-facing string is already externalized: `package.json` uses `%key%` placeholders resolved by `package.nls.json`, and runtime strings route through a `getLocalization()` helper backed by `vscode.l10n.t`. Translators can ship locale files without touching any code. A CI-guard test fails the build the moment anyone forgets a default.

## Telemetry

The manager emits typed events through the shared `@salesforce/vscode-service-provider` telemetry pipeline (same mechanism Agentforce Vibes uses), prefixed `sfdxManager_` so downstream dashboards can filter. Coverage: activation / deactivation, group apply (counts by category), extension install / uninstall / update, catalog refresh, dependency check, errors. Payloads carry extension ids, group ids, scope enums, counts, durations, and exit codes — never file paths, workspace names, org ids, or usernames. Enablement is fully delegated to the shared service, which honors `telemetry.telemetryLevel` and any Salesforce-side opt-out automatically.

## Under the hood

- **~6,800 lines of TypeScript** across 44 source files, packaged as a lean VSIX.
- **321 unit tests across 27 suites**, all green. Compile, lint, and test are hard gates on every change. Tests cover services, tree providers, command flows, the BusyState refcount registry, and contract checks against `package.json` / `package.nls.json`.
- Fully offline-safe: no activation step reaches the network without a user-controlled opt-in (via `updateCheck`), and every probe fails silently to a no-op. The CLI update check does zero HTTP of its own — it reuses what `sf version` already emits.
- BSD-3-Clause licensed. Built on the same conventions (esbuild, Jest, strict TypeScript) as the rest of the IDEx extension family.

## Try it

The extension is pre-release. Grab the `.vsix` from the repository, install it with `code --install-extension salesforcedx-vscode-manager-0.1.0.vsix`, press F5, and look for the layered-stack icon in the activity bar. The Get Started walkthrough covers the four core flows.
