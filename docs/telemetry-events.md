# Telemetry events

The manager emits telemetry through `salesforcedx-vscode-core`'s shared
reporter (acquired via `@salesforce/vscode-service-provider`'s
`ServiceProvider.getService(ServiceType.Telemetry, ...)`). All events
are prefixed `sfdxManager_` so downstream dashboards can filter manager
events from core's.

> **Keep this doc in sync with the code.** Every typed emit helper on
> `src/services/telemetryService.ts` should have a row in the table
> below. If you add a new helper or change a payload field, update
> this file in the same commit.

## Governance

- **Global gate:** VSCode's `telemetry.telemetryLevel` always wins — if
  the user has telemetry off, nothing fires regardless of the settings
  below. This is enforced downstream by the ServiceProvider.
- **Extension gate:** `salesforcedx-vscode-manager.telemetry.enabled`
  (default `true`) is an extension-specific kill switch. Flip it off
  to mute manager events while leaving the rest of VSCode telemetry
  alone.
- **No PII:** payloads carry extension ids (public marketplace data),
  group ids, scope enums, counts, durations in ms, and exit codes.
  File paths, workspace names, org ids, and usernames are **never**
  transmitted. When in doubt, drop the field and add a log line
  instead.

## Event catalog

| Event name | Fired from | When | Properties (strings) | Measurements (numbers) |
|---|---|---|---|---|
| `sfdxManager_activation` | `src/extension.ts` (`activate`) | Extension activation completes. Wraps `sendExtensionActivationEvent(hrStart)`, so the reporter also attaches an activation-duration measurement automatically. | — | activation duration (via `hrStart`) |
| `sfdxManager_deactivation` | `src/extension.ts` (`deactivate`) | VSCode unloads the extension. | — | — |
| `sfdxManager_group_apply` | `src/commands/groupCommands.ts` (end of `runApply`) | After `applyGroup` settles, regardless of outcome. | `groupId`, `source` (`code` / `pack` / `catalog` / `user`), `scope` (`disableOthers` / `enableOnly` / `ask`) | `enabled`, `disabled`, `depBlocked`, `manualEnable`, `manualDisable`, `skipped`, `installedFromVsix` |
| `sfdxManager_extension_install` | `src/commands/updateCommands.ts` (`installExtension`) | One event per install attempt — success AND failure. | `extensionId`, `source` (`marketplace` / `vsix` / `unknown`) | `exitCode` (0 = success) |
| `sfdxManager_extension_uninstall` | `src/commands/updateCommands.ts` (`uninstallExtension`) | One event per uninstall attempt, per cascade member. Root + dependents each get their own event. | `extensionId`, `source` | `exitCode` |
| `sfdxManager_extension_update` | `src/commands/updateCommands.ts` (`updateExtension`) | One event per update attempt. | `extensionId`, `source` | `exitCode` |
| `sfdxManager_catalog_refresh` | `src/commands/catalogCommands.ts` (`refreshSalesforceCatalog`) | After the marketplace probe returns. | — | `entryCount`, `durationMs` |
| `sfdxManager_dependency_check` | `src/commands/dependencyCommands.ts` (`runDependencyCheck`) | After the Dependencies tree finishes a full check. | — | `ok`, `warn`, `fail`, `unknown` |
| `sfdxManager_error` | Any command handler (via `TelemetryService.sendError`) | Exception caught before surfacing `notifyError`. | (event name is `<commandId>:<errorName>`, passed to `sendException`) | — |

## Implementation pointers

- All emission goes through `src/services/telemetryService.ts` — do
  NOT call `reporter.sendCommandEvent(...)` directly from feature
  code. The typed helpers exist so callers can't typo event names or
  omit required fields.
- The helpers are safe no-ops when:
  - The core reporter couldn't be acquired (core missing / wedged).
  - `telemetry.enabled` is `false`.
  - The global `telemetry.telemetryLevel` disables it downstream.
- Every `activate()` in `src/extension.ts` runs `TelemetryService.init`
  **before** any other service init, so the reporter is ready for
  anything a sibling service might emit. Config changes to
  `telemetry.enabled` call `TelemetryService.refreshEnabled` without
  re-initializing the reporter.

## Adding a new event

1. Add a key to the `EVENT` constants block at the top of
   `src/services/telemetryService.ts`.
2. Add a typed emit helper — `sendThing(args: { ... }): void` — that
   builds the properties + measurements and calls
   `reporter.sendCommandEvent` (or `sendException` for errors).
3. Call the helper from the command handler at the right moment.
4. Add a unit test in `test/unit/telemetryService.test.ts` covering
   the happy path + the two no-op paths (reporter missing;
   `telemetry.enabled = false`).
5. **Update this file.** Add the row to the event catalog above.
   Agent directions in `CLAUDE.md` require this step.
