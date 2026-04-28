# Salesforce Extensions Manager — 3-Minute Demo Script

A tight 3-minute walkthrough covering Groups → Dependencies → CLI update → VSIX overrides → Settings. Spoken copy is in *italics*; `[brackets]` are on-screen actions.

## Pre-flight state (set up before recording)

- **Apex group currently applied** — Apex, Replay Debugger, Apex Log, Apex Testing, Apex OAS, SOQL, Visualforce all installed.
- **`sf` CLI installed but behind** — older release so `sf version` emits the "update available" warning. You can force this by pinning: `sf update --version 2.130`.
- **`vsixDirectory` setting configured**, pointing at an empty folder.
- **One CI-style `.vsix` on the desktop**, ready to drag — e.g. `salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix` (intentionally oddly-named to show prefix matching).
- VSCode Extension Host window open, Salesforce Extensions Manager activity-bar icon visible, Groups view expanded.

---

## 0:00 — Hook · 10s

*[Shot: activity bar icon → Groups view with Apex active]*

> *"A Salesforce project touches a lot of extensions — 18 in the base Salesforce Extension Pack, 23 in the Expanded Pack. The Extensions Manager is one place to switch toolchains, check your prerequisites, and run local builds."*

---

## 0:10 — Groups · 45s

*[Point at Apex group row, expanded showing member rows installed]*

> *"Apex is active — Replay Debugger, Log, OAS, SOQL. I'm moving to front-end work, so I'll apply Lightning."*

*[Right-click Lightning → Apply Group]*

> *"One click. The manager installs Lightning members and cleans up anything I'm not using. It reads VSCode's dependency graph so cascaded uninstalls happen in the right order."*

*[Rows spin; the rest of the panel freezes — buttons disappear for the duration]*

> *"Rows spin while they work; the whole panel locks so a second click can't race the first."*

*[Apply settles; tree updates]*

> *"Lightning is active: Core, Services, LWC, ESLint, Prettier, SLDS."*

---

## 0:55 — Dependencies (auto-run) · 25s

*[Scroll to Dependencies view; rows already populated]*

> *"Dependencies auto-ran right after the apply. Salesforce CLI, Java, Node, Git — everything my managed extensions declared they need. Green means good. Any red or yellow would have fired a toast with a 'Show Dependencies' shortcut."*

*[Hover a row; tooltip shows remediation line + link]*

> *"Each row has a fix link if something's missing."*

---

## 1:20 — CLI update · 30s

*[Point to status bar: `$(arrow-circle-up) sf v2.131.7`]*

> *"My CLI is behind. The manager saw that from `sf`'s own `sf version` output — no separate network probe. Status bar flags it, and the Salesforce CLI row in the Dependencies view shows the same badge."*

*[Click the status-bar item]*

> *"One click…"*

*[Dedicated terminal opens and runs `sf update`]*

> *"…opens a dedicated terminal and runs `sf update` so I see exactly what's happening."*

*[`sf update` completes; close the terminal]*

> *"Close the terminal, and the manager re-probes automatically. Badge clears, no reload."*

---

## 1:50 — VSIX overrides · 50s

*[Bring a Finder window forward; drag the CI-renamed `.vsix` into the configured override directory]*

> *"Last flow: local VSIX overrides — this is how my team tests unreleased CI builds."*

*[Back to VSCode. A new **VSIX Overrides** view has appeared in the activity bar tree, listing the dropped file]*

> *"The manager auto-installs every `.vsix` it finds. Filename doesn't need the standard `publisher.name-version` shape — this one has no publisher prefix and extra tokens, and it still resolves to Agentforce Vibes via longest-prefix matching."*

*[Scroll to the Groups tree; point at the Agentforce Vibes row]*

> *"The matching Groups row is locked — no install or uninstall buttons, `vsix-managed` badge. The override directory is the source of truth."*

*[Switch back to the VSIX Overrides view; click the row's inline trash; confirm]*

> *"Trash the file to stop overriding, or edit it to bump versions. Groups row unlocks the moment the file's gone."*

---

## 2:40 — Settings · 15s

*[Open Settings → search `salesforcedx-vscode-manager`]*

> *"Everything's configurable — grouped into five sections: Groups, VSIX Overrides, Dependencies, Marketplace, Status Bar. Toggles are discoverable, not buried."*

---

## 2:55 — Close · 5s

> *"One extension, one place. Thanks."*

---

## Delivery tips

- **Rehearse the click choreography once before recording.** Apply-group is ~15 seconds of spinning; don't over-narrate — let the UI speak during the freeze.
- **Keep the output channel closed** during the Groups demo so the info logs don't distract. Open it only if someone asks "what just happened."
- **Screen-record at 1920×1200 or larger** so the status-bar items are legible; the CLI badge at the default VSCode size is small.
- **If the CLI update lands fast**, the auto-refresh might clear the badge before you finish the sentence — that's actually a good visual beat; let it land and say *"…and it's already cleared."*
- **Keep the demo machine online** — everything here runs fine on slow networks, but you want the marketplace install for Lightning members and the `sf update` to actually complete during the take.
