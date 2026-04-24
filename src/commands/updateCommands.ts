import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import { getLocalization, LocalizationKeys } from '../localization';
import { BUSY_SENTINELS, type BusyState } from '../util/busyState';
import { notifyError, notifyInfo, notifyWarn } from '../util/notify';
import type { CodeCliService } from '../services/codeCliService';
import type { ExtensionService } from '../services/extensionService';
import type { SettingsService } from '../services/settingsService';
import { TelemetryService } from '../services/telemetryService';
import type { Logger } from '../util/logger';
import { maybeReloadAfterChange } from '../util/reloadPrompt';
import type { GroupsTreeProvider } from '../views/groupsTreeProvider';

interface Deps {
  codeCli: CodeCliService;
  extensions: ExtensionService;
  settings: SettingsService;
  logger: Logger;
  tree: GroupsTreeProvider;
  busy?: BusyState;
}

/**
 * `withBusy` is optional because many unit tests wire commands up
 * without a BusyState. The production path always passes one; the
 * optional chaining keeps the tests untouched without requiring a
 * full stub for every test.
 */
const withBusy = async <T>(
  deps: Deps,
  ids: readonly string[],
  fn: () => Promise<T>
): Promise<T> => (deps.busy ? deps.busy.withBusy(ids, fn) : fn());

/**
 * Shapes VSCode can hand our `view/item/context` menu handlers:
 *   - a raw string (programmatic invocation from our own code),
 *   - an extension node `{ kind: 'extension', extensionId }` (leaf rows),
 *   - a group node `{ kind: 'group', group: { marketplaceExtensionId } }`
 *     (pack rows' "Open in Marketplace" button).
 * `extractExtensionId` normalizes all three to the publisher.name id.
 */
interface ExtensionNodeContext {
  kind?: 'extension';
  extensionId?: string;
}
interface GroupNodeContext {
  kind?: 'group';
  group?: { marketplaceExtensionId?: string };
}

const extractExtensionId = (arg: unknown): string | undefined => {
  if (typeof arg === 'string') return arg;
  if (!arg || typeof arg !== 'object') return undefined;
  if ('extensionId' in arg) {
    const id = (arg as ExtensionNodeContext).extensionId;
    if (typeof id === 'string') return id;
  }
  if ('group' in arg) {
    const id = (arg as GroupNodeContext).group?.marketplaceExtensionId;
    if (typeof id === 'string') return id;
  }
  return undefined;
};

export const registerUpdateCommands = (
  context: vscode.ExtensionContext,
  deps: Deps
): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.updateExtension, async (arg?: unknown) => {
      const id = extractExtensionId(arg);
      if (!id) {
        void notifyWarn(getLocalization(LocalizationKeys.updateRequiresNode));
        return;
      }
      await withBusy(deps, [id], async () => {
        const { exitCode, stderr } = await deps.codeCli.installExtension(id, true);
        const label = deps.extensions.label(id);
        TelemetryService.sendExtensionOp('update', {
          extensionId: id,
          source: 'marketplace',
          exitCode
        });
        if (exitCode !== 0) {
          deps.logger.error(`update(${id}): exit ${exitCode}`, stderr);
          void notifyError(getLocalization(LocalizationKeys.updateFailed, label), { logger: deps.logger });
          return;
        }
        deps.logger.info(`update(${id}): reinstalled with --force.`);
        deps.extensions.clearCliVersionCache();
        void deps.tree.refreshVersionInfo();
        // `vscode.extensions.all` only refreshes on reload, so the tree
        // keeps showing the pre-update state until the user reloads.
        // Prompt (or auto, per setting) so the update is actually live.
        void maybeReloadAfterChange(true, deps.settings);
      });
    }),

    vscode.commands.registerCommand(COMMANDS.updateAllSalesforce, async () => {
      const ids = deps.extensions.managed().map(e => e.id);
      if (ids.length === 0) {
        void notifyInfo(getLocalization(LocalizationKeys.updateAllNone));
        return;
      }
      await withBusy(deps, [BUSY_SENTINELS.updateAll, ...ids], async () => {
        let ok = 0;
        let failed = 0;
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: getLocalization(LocalizationKeys.updateAllProgressTitle)
          },
          async progress => {
            for (const id of ids) {
              progress.report({ message: id });
              const result = await deps.extensions.install(id, { force: true });
              if (result.exitCode === 0) {
                ok++;
              } else {
                failed++;
                deps.logger.warn(`updateAll: ${id} exit ${result.exitCode} ${result.stderr ?? ''}`);
              }
            }
          }
        );
        deps.extensions.clearCliVersionCache();
        void deps.tree.refreshVersionInfo();
        void notifyInfo(
          failed
            ? getLocalization(LocalizationKeys.updateAllSummaryFailed, ok, failed)
            : getLocalization(LocalizationKeys.updateAllSummaryOk, ok),
          { logger: failed ? deps.logger : undefined }
        );
        void maybeReloadAfterChange(ok > 0, deps.settings);
      });
    }),

    vscode.commands.registerCommand(COMMANDS.installExtension, async (arg?: unknown) => {
      const id = extractExtensionId(arg);
      if (!id) {
        void notifyWarn(getLocalization(LocalizationKeys.installExtensionRequiresNode));
        return;
      }
      const label = deps.extensions.label(id);
      if (deps.extensions.isInstalled(id)) {
        // No toast: the tree already shows the installed row; log so the
        // click still has a trail in the output channel.
        deps.logger.info(`install(${id}): already installed; nothing to do.`);
        return;
      }
      await withBusy(deps, [id], async () => {
        const result = await deps.extensions.install(id);
        TelemetryService.sendExtensionOp('install', {
          extensionId: id,
          source: result.source,
          exitCode: result.exitCode
        });
        if (result.exitCode !== 0) {
          deps.logger.error(`install(${id}): exit ${result.exitCode}`, result.stderr);
          void notifyError(
            getLocalization(LocalizationKeys.installExtensionFailed, label),
            { logger: deps.logger }
          );
          return;
        }
        deps.logger.info(`install(${id}): ${result.source}.`);
        deps.extensions.clearCliVersionCache();
        void deps.tree.refreshVersionInfo();
        deps.tree.refresh();
        // Install lands on disk but vscode.extensions.all won't pick up
        // the new entry until a reload. Prompt so the tree and the
        // Extensions view finally agree on state.
        void maybeReloadAfterChange(true, deps.settings);
      });
    }),

    vscode.commands.registerCommand(COMMANDS.uninstallExtension, async (arg?: unknown) => {
      const id = extractExtensionId(arg);
      if (!id) {
        void notifyWarn(getLocalization(LocalizationKeys.installExtensionRequiresNode));
        return;
      }
      const label = deps.extensions.label(id);
      // Defense-in-depth: the view/item/context when-clause already hides
      // the inline Uninstall button for :locked rows, but the command can
      // still be dispatched programmatically. Surface the reason as an
      // info toast so the user knows why we refused.
      if (deps.extensions.isLocked(id)) {
        void notifyInfo(
          getLocalization(LocalizationKeys.uninstallExtensionLocked, label),
          { logger: deps.logger }
        );
        return;
      }
      if (!deps.extensions.isInstalled(id)) {
        // No toast: the tree already marks the row "not installed"; log
        // so the click still has a trail.
        deps.logger.info(`uninstall(${id}): not installed; nothing to do.`);
        return;
      }

      // Enumerate transitive dependents so the uninstall cascades properly
      // instead of erroring with "Cannot uninstall X. Y depends on this."
      const graph = deps.extensions.getDependencyGraph();
      const dependents = deps.extensions.transitiveDependents([id], graph);
      const installedDependents = [...dependents].filter(d => deps.extensions.isInstalled(d));

      // One modal: either a plain "Uninstall?" or the cascade warning.
      const proceed = getLocalization(LocalizationKeys.uninstallExtensionProceed);
      const prompt = installedDependents.length === 0
        ? getLocalization(LocalizationKeys.uninstallExtensionConfirm, label)
        : getLocalization(
            LocalizationKeys.uninstallExtensionCascadeConfirm,
            label,
            installedDependents.length,
            installedDependents.map(d => deps.extensions.label(d)).join(', ')
          );
      const confirm = await vscode.window.showWarningMessage(
        prompt,
        { modal: true },
        proceed
      );
      if (confirm !== proceed) return;

      // Uninstall dependents BEFORE the root so VSCode doesn't refuse any
      // step. topologicalUninstallOrder orders dependents-first for us.
      const victims = [id, ...installedDependents];
      const order = deps.extensions.topologicalUninstallOrder(victims, graph);
      // Spin every row in the cascade simultaneously so the user sees
      // the whole chain is working, not just the one they clicked.
      await withBusy(deps, order, async () => {
        const uninstalled: string[] = [];
        let failed = 0;
        for (const victim of order) {
          const result = await deps.extensions.uninstall(victim);
          TelemetryService.sendExtensionOp('uninstall', {
            extensionId: victim,
            source: 'marketplace',
            exitCode: result.exitCode
          });
          if (result.exitCode !== 0) {
            failed++;
            deps.logger.error(`uninstall(${victim}): exit ${result.exitCode}`, result.stderr);
            continue;
          }
          uninstalled.push(victim);
          deps.logger.info(`uninstall(${victim}): ok.`);
        }
        deps.extensions.clearCliVersionCache();
        void deps.tree.refreshVersionInfo();
        deps.tree.refresh();

        if (failed > 0) {
          void notifyError(
            getLocalization(
              LocalizationKeys.uninstallExtensionPartialCascade,
              uninstalled.length,
              order.length
            ),
            { logger: deps.logger }
          );
          return;
        }
        // Uninstall tombstones the extension directory for cleanup on
        // next window start, but vscode.extensions.all keeps the row
        // alive for the rest of this session. Prompt for a reload so
        // the tree, the Extensions view, and the runtime snapshot all
        // agree the extension is gone.
        void maybeReloadAfterChange(uninstalled.length > 0, deps.settings);
      });
    }),

    vscode.commands.registerCommand(COMMANDS.openInMarketplace, async (arg?: unknown) => {
      const id = extractExtensionId(arg);
      if (!id) {
        void notifyWarn(getLocalization(LocalizationKeys.openInMarketplaceRequiresNode));
        return;
      }
      // `extension.open` is VSCode's built-in command for opening the
      // Extensions-view details panel for a given id. It works for
      // installed and uninstalled extensions alike, and surfaces the
      // Marketplace's Install button when the extension isn't installed.
      await vscode.commands.executeCommand('extension.open', id);
    }),

    vscode.commands.registerCommand(COMMANDS.checkForUpdates, async () => {
      // Previously we also fired `workbench.extensions.action.checkForUpdates`
      // to let VSCode refresh its own update state. That command pops a
      // native modal "All extensions are up to date." / "Install and Reload"
      // dialog we can't suppress, which is jarring when the user only
      // expected our own tree to refresh. Our MarketplaceVersionService
      // already drives the manager's own update indicators, so we stick
      // to that. The Groups tree re-renders with `$(arrow-circle-up)`
      // badges on any row that has a newer version available — that's
      // the feedback the user needs; no success toast required. Users
      // who want VSCode's native dialog can still invoke
      // `Extensions: Check for Extension Updates` from the palette.
      deps.extensions.clearCliVersionCache();
      await deps.tree.refreshVersionInfo();
      deps.logger.info('checkForUpdates: tree refreshed via MarketplaceVersionService.');
    })
  );
};
