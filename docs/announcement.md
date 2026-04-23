# Salesforce Extensions Manager — v0.1 Announcement

**Introducing the Salesforce Extensions Manager for VSCode.**

If you develop on the Salesforce Platform from VSCode, you already live in a large and growing extension ecosystem — the core Apex tooling, Lightning, LWC, SOQL, Visualforce, the Agentforce Vibes AI assistant, SLDS, Code Analyzer, and more than twenty other first-party extensions. Each is great at its job, but together they create four recurring pain points we kept seeing on the team:

1. You rarely need everything active at once. An Apex-heavy workday loads Lightning tooling you're not using; an LWC day leaves the Apex debugger idling in the background.
2. External prerequisites — the `sf` CLI, Java, Node — are invisible until something fails, and each extension invents its own "is Java installed?" check.
3. QA and extension developers who need to run unreleased `.vsix` builds have no clean way to swap them in against a Salesforce-published baseline.
4. Discovering everything Salesforce publishes on the Marketplace is a manual job.

**Salesforce Extensions Manager** tackles all four. It's a standalone VSCode extension (`salesforce.salesforcedx-vscode-manager`) that lives quietly on your activity bar — a stacked-layers icon — and unfolds into two views and a status-bar footprint.

## Groups: one-click control of your active toolchain

The **Groups** view lets you switch between named sets of extensions:

- **Handcrafted built-ins** for the three most common workflows: Apex, Lightning, and a React stub you can fill in for JS-heavy work.
- **Salesforce Extension Pack** and **Salesforce Extension Pack (Expanded)** — both shipped as built-in groups with the exact member lists from the pack manifests, so you can apply either one even if the pack itself isn't installed yet. When the pack *is* installed, the manager upgrades the entry to use the pack's live manifest so member changes flow through automatically.
- **Custom groups** you define yourself — create, edit, delete, import, export, even move between user and workspace scope so a group can be workspace-specific when it needs to be.
- **Auto-discovered pack groups** — any Salesforce-published extension whose `package.json` declares an `extensionPack` surfaces as a read-only group with a `$(package)` badge.

Applying a group installs every member via the `code` CLI and, optionally, uninstalls non-members so your workspace is left with exactly the tools the group calls for. The manager understands VSCode's dependency graph, so it auto-includes transitive `extensionDependencies`, refuses to uninstall something another installed extension still depends on (no more "Cannot uninstall — X depends on this" banners), and orders uninstalls topologically so extension packs come off before their members. A single "Apply complete — reload window?" prompt replaces VSCode's one-banner-per-uninstall, and you can switch to auto-reload if you prefer.

Every extension node in the tree also exposes per-extension Install, Uninstall, and Update buttons — you never have to edit a group definition just to trim one thing out of it.

## All Salesforce Extensions, straight from the Marketplace

The manager queries the VSCode Marketplace Gallery API for every extension published under the `salesforce` publisher and surfaces the whole catalog as a read-only group, with install counts and short descriptions. Because the catalog is too large to apply as a single group, the Apply button is replaced with:

- Per-extension Install / Uninstall buttons directly on each node, and
- **`SFDX Manager: Browse Salesforce Extensions...`** — a multi-select Quick Pick for discovering and installing specific extensions without leaving VSCode.

The catalog refreshes on a schedule you control via the `updateCheck` setting (once-per-session by default) and stays fully offline-safe: when the Marketplace is unreachable, the group quietly prompts for a refresh rather than erroring.

## Dependencies: know your prerequisites before they break you

A separate Dependencies view shows every external prerequisite the extensions in your workspace actually need — the Salesforce CLI, Java 11+, Node, Git, and more — with color-coded pass/warn/fail icons, remediation hints, and a one-click "copy markdown report" command for bug reports.

What's new here is the **contract**: any Salesforce extension can declare its prerequisites as a top-level `salesforceDependencies` array in its own `package.json`, with five check types (`exec`, `env`, `file`, `nodeVersion`, `extensionInstalled`). The manager reads this statically — no extension activation required — so even a disabled extension contributes to the tree. For extensions that haven't adopted the contract yet, a built-in shim catalog fills the gap (Apex already gets the Java JDK check). A small layer of logical-check deduplication means if four extensions all depend on the same JDK, you see one row, not four.

## VSIX override directory for unreleased builds

Point `salesforcedx-vscode-manager.vsixDirectory` at a folder of local `.vsix` files and the manager installs those in place of the Marketplace version. Install provenance is tracked per extension; a `$(package)` badge and a warning-colored status-bar indicator tell you at a glance when your workspace is running non-production builds. Four commands — Refresh, Open Directory, Clear Overrides, and a central VSIX Management menu — keep the workflow explicit. A `FileSystemWatcher` keeps the tree in sync when you drop a new build into the folder.

## Status bar and keybinding

Two status-bar items in the lower-left show the currently-applied group and the VSIX-override count (when active, with a warning background). Both are clickable — group switches on a click, VSIX management on a click. A global **⌘/Ctrl + Alt + G** keybinding fires the group Quick Pick for fast switching.

## Built to be localized

Every user-facing string is already externalized: `package.json` uses `%key%` placeholders resolved by `package.nls.json`, and runtime strings route through a `getLocalization()` helper backed by `vscode.l10n.t`. Translators can ship locale files without touching any code. A CI-guard test fails the build the moment anyone forgets a default.

## Under the hood

- **~9,000 lines of TypeScript** across 35+ source files, packaged as a lean ~43 KB VSIX.
- **207 unit tests across 19 suites**, all green. Compile, lint, and test are hard gates on every change.
- Fully offline-safe: no activation step reaches the network without a user-controlled opt-in.
- BSD-3-Clause licensed. Built on the same conventions (esbuild, Jest, strict TypeScript) as the rest of the IDEx extension family.

## Try it

The extension is pre-release. Grab the `.vsix` from the repository, install it with `code --install-extension salesforcedx-vscode-manager-0.1.0.vsix`, press F5, and look for the layered-stack icon in the activity bar. The Get Started walkthrough covers the four core flows.
