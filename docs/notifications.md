# Notifications

Every user-facing toast, modal, and warn/error surface the manager
raises. If you add a new command or change the copy on an existing
one, update the matching row.

The underlying rule (from `CLAUDE.md`): **default to no toast on
success when the tree, Problems view, or status bar already reflects
the outcome. Toasts are for action, error, or progress.**

> **Keep this doc in sync with the code.** Every `notifyInfo` /
> `notifyWarn` / `notifyError` and every raw
> `vscode.window.show*Message` call should appear here (or be
> justified as "intentionally silent" in the command it belongs to).
> Update this file whenever you add, remove, or retune a notification.

## Helpers and conventions

- **`src/util/notify.ts`** — `notifyInfo` / `notifyWarn` /
  `notifyError` always attach at least one action button so VSCode
  doesn't auto-dismiss. Use these for every state-change result; raw
  `show*Message` is acceptable only for modal confirmation prompts
  (`{ modal: true }`) where the user's response is the point.
- **Localization** — every user-facing string is keyed in
  `src/localization/localizationKeys.ts` and defaulted in
  `localizationValues.ts`. Never hardcode English copy in a call
  site.
- **Silent success** — if a command's success path doesn't toast,
  log through `deps.logger.info(...)` so the output channel still
  has an audit trail.

## Toast / modal catalog

Legend — **Kind:**
`info` = `notifyInfo` / `showInformationMessage`,
`warn` = `notifyWarn` / `showWarningMessage`,
`error` = `notifyError` / `showErrorMessage`,
`modal` = `show*Message({ modal: true }, ...)` (blocking confirm).

### Activation (`src/extension.ts`)

| Kind | Trigger | Localization key | Why it fires | Action buttons |
|---|---|---|---|---|
| warn | `vsixDirectory` setting points at a path that doesn't exist, at activation | `vsixDirectoryMissingWarn` | Needs user action — a stale setting will silently skip VSIX overrides. | `Open Settings` |

### Group commands (`src/commands/groupCommands.ts`)

| Kind | Command | Localization key | When | Action buttons |
|---|---|---|---|---|
| warn | `applyGroup` | `catalogCannotApplyAsGroup` | User tried to apply the synthetic `All Salesforce Extensions` catalog group. | — |
| warn | `applyGroup` | (inline literal: `Group "{0}" has no members.`) | Member list is empty (malformed user group snuck past `validateGroup`). | — |
| warn | `applyGroup` (summary) | composed from `applySummaryApplied` + sub-keys | Apply finished with `dependencyBlocked`, `needsManualEnable`, `needsManualDisable`, or `skipped` entries. Clean applies are silent. | `Show Log` |
| info (modal) | `applyGroup` (reload) | `reloadAfterApplyPrompt` + `reloadAfterApplyAction` | Apply touched extensions, `reloadAfterApply` setting is `prompt`. | `Reload Window` |
| modal | `deleteGroup` | `deleteGroupConfirm` | Before delete/reset of a group. | `Delete` / `Reset to default` |
| error | `moveGroupScope` | `moveGroupScopeBuiltInError` | User tried to move a built-in group's scope. Built-ins live in code; can't be moved. | — |
| info | `exportGroups` | `exportNoUserGroups` | User triggered Export but has no user groups (nothing to write). | — |
| info | `exportGroups` | `exportSuccess` | File written — no tree visual reflects "file on disk", so we confirm. | — |
| error | `importGroups` | `importInvalidFile` | JSON parse / schema error on import. | — |
| modal | `importGroups` | `importConflictPrompt` (+ three action labels) | Per-conflict prompt during import. | `Overwrite` / `Skip` / `Skip All Conflicts` |
| info | `importGroups` | `importSummary` | Final count after import — file-derived result has no tree visual. | — |

### Update / install / uninstall commands (`src/commands/updateCommands.ts`)

| Kind | Command | Localization key | When | Action buttons |
|---|---|---|---|---|
| warn | `updateExtension` | `updateRequiresNode` | Called from the palette without an extension-node arg. | — |
| error | `updateExtension` | `updateFailed` | `code --install --force` returned non-zero. | `Show Log` |
| info | `updateAllSalesforce` | `updateAllNone` | User hit "Update All" with zero managed extensions — confirms the empty state. | — |
| info | `updateAllSalesforce` (summary, success) | `updateAllSummaryOk` | Bulk op has no per-row visual — summary is the feedback. | — |
| warn | `updateAllSalesforce` (summary, partial) | `updateAllSummaryFailed` | Some updates failed. | `Show Log` |
| warn | `installExtension` | `installExtensionRequiresNode` | Palette dispatch without an extension-node arg. | — |
| error | `installExtension` | `installExtensionFailed` | Install returned non-zero. | `Show Log` |
| warn | `uninstallExtension` | `installExtensionRequiresNode` | Palette dispatch without an extension-node arg (reuses the install key). | — |
| info | `uninstallExtension` | `uninstallExtensionLocked` | Target is locked (manager's own `extensionDependencies` chain). Defense-in-depth — menu already hides the button. | `Show Log` |
| modal | `uninstallExtension` | `uninstallExtensionConfirm` / `uninstallExtensionCascadeConfirm` | Single confirm before uninstall. Cascade variant lists dependents by display name. | `Uninstall` |
| error | `uninstallExtension` | `uninstallExtensionPartialCascade` | Some cascade members failed to uninstall. | `Show Log` |
| warn | `openInMarketplace` | `openInMarketplaceRequiresNode` | Palette dispatch without an extension-node arg. | — |

### Dependency commands (`src/commands/dependencyCommands.ts`)

| Kind | Command | Localization key | When | Action buttons |
|---|---|---|---|---|
| warn | `runDependencyCheck` | `depsSummary` (message body) + `depsShowAction` | At least one dep row is `warn` / `fail` / `unknown`. All-green runs are silent — tree is the source of truth. | `Show Dependencies` |

### Catalog commands (`src/commands/catalogCommands.ts`)

| Kind | Command | Localization key | When | Action buttons |
|---|---|---|---|---|
| warn | `refreshSalesforceCatalog` | `refreshCatalogEmpty` | Catalog probe returned zero entries — usually offline / auth failure. | `Show Log` |
| info | `browseSalesforceExtensions` | `browseEmpty` | User triggered Browse before a catalog refresh. Prompts next action. | `Show Log` |
| warn | `browseSalesforceExtensions` (partial failure) | `browseInstallSummaryFailed` | Some installs failed in the bulk op. | `Show Log` |

### VSIX commands (`src/commands/vsixCommands.ts`)

| Kind | Command | Localization key | When | Action buttons |
|---|---|---|---|---|
| warn | `refreshFromVsixDirectory` | `vsixDirectoryNotConfigured` | Setting is unset. | `Open Settings` |
| info | `refreshFromVsixDirectory` | `vsixNoFilesFound` | Directory is set but empty. User asked to refresh → we confirm the empty state. | — |
| warn | `refreshFromVsixDirectory` | `vsixRefreshSummaryFailed` | Some reinstalls from VSIX failed. | — |
| info | `clearVsixOverrides` | `vsixNoOverrides` | User hit Clear with nothing sourced from VSIX — confirms the no-op. | — |
| modal | `clearVsixOverrides` | `vsixClearConfirm` + `vsixClearProceed` | Before wiping all VSIX-sourced overrides and reinstalling from marketplace. | `Proceed` |

### Extension service (`src/services/extensionService.ts`)

| Kind | Trigger | Localization key | When | Action buttons |
|---|---|---|---|---|
| info | `showManualToggleHint` | `manualToggleHint` | Apply resulted in `needsManualEnable` or `needsManualDisable`. The Extensions view is opened with a filter; this toast tells the user to act there. | — |

## Intentionally silent paths

These are successful outcomes we deliberately don't toast. The tree
or status bar already reflects the state change; the command logs to
the output channel. If you think you need a toast here, check
`docs/notification-verification.md` §9 first — those are the
regression canaries.

- `installExtension` success, and `installExtensionAlreadyInstalled` no-op.
- `uninstallExtension` success (single + cascade), and no-op when not installed.
- `updateExtension` success.
- `checkForUpdates` (tree badges update).
- `refreshSalesforceCatalog` success (tree member count updates).
- `browseSalesforceExtensions` success (tree rows flip).
- `refreshFromVsixDirectory` success.
- `clearVsixOverrides` success (tree + status-bar item update).
- `enableAllSalesforce` / `disableAllSalesforce`.
- `createCustomGroup` / `editGroup` / `deleteGroup` / `moveGroupScope` success (tree changes).
- Clean `applyGroup` result (nothing actionable; the reload prompt is separate).
- `runDependencyCheck` all-green.
- `copyDependencyReport` (clipboard is the feedback).

## Adding a new notification

1. Add the localization key + default value to
   `src/localization/localizationKeys.ts` and `localizationValues.ts`.
2. Call through `notify.ts` (not raw `show*Message`), passing
   `{ logger: deps.logger }` when you want the message echoed to the
   output channel.
3. For modals, `show*Message({ modal: true }, ...proceedLabel)` is
   the right API — `notify.ts` is only for non-modal toasts.
4. If the success path should stay silent, log through
   `deps.logger.info(...)` and cite the notification doc in the
   comment next to the call site.
5. **Update this file.** Add a row to the matching section or, if
   intentionally silent, add it to §"Intentionally silent paths".
   Agent directions in `CLAUDE.md` require this step.
