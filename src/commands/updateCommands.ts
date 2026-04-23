import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import { getLocalization, LocalizationKeys } from '../localization';
import { notifyError, notifyInfo, notifyWarn } from '../util/notify';
import type { CodeCliService } from '../services/codeCliService';
import type { ExtensionService } from '../services/extensionService';
import type { SettingsService } from '../services/settingsService';
import type { Logger } from '../util/logger';
import type { GroupsTreeProvider } from '../views/groupsTreeProvider';

interface Deps {
  codeCli: CodeCliService;
  extensions: ExtensionService;
  settings: SettingsService;
  logger: Logger;
  tree: GroupsTreeProvider;
}

/**
 * Node context arg shape surfaced by the Groups tree for `view/item/context`
 * menu items. We only care about `extensionId` here.
 */
interface ExtensionNodeContext {
  kind?: 'extension';
  extensionId?: string;
}

const extractExtensionId = (arg: unknown): string | undefined => {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && 'extensionId' in arg) {
    const id = (arg as ExtensionNodeContext).extensionId;
    return typeof id === 'string' ? id : undefined;
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
      const { exitCode, stderr } = await deps.codeCli.installExtension(id, true);
      if (exitCode !== 0) {
        deps.logger.error(`update(${id}): exit ${exitCode}`, stderr);
        void notifyError(getLocalization(LocalizationKeys.updateFailed, id), { logger: deps.logger });
        return;
      }
      deps.logger.info(`update(${id}): reinstalled with --force.`);
      deps.extensions.clearCliVersionCache();
      void deps.tree.refreshVersionInfo();
      void notifyInfo(getLocalization(LocalizationKeys.updateSucceeded, id));
    }),

    vscode.commands.registerCommand(COMMANDS.updateAllSalesforce, async () => {
      const ids = deps.extensions.managed().map(e => e.id);
      if (ids.length === 0) {
        void notifyInfo(getLocalization(LocalizationKeys.updateAllNone));
        return;
      }
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
    }),

    vscode.commands.registerCommand(COMMANDS.installExtension, async (arg?: unknown) => {
      const id = extractExtensionId(arg);
      if (!id) {
        void notifyWarn(getLocalization(LocalizationKeys.installExtensionRequiresNode));
        return;
      }
      if (deps.extensions.isInstalled(id)) {
        void notifyInfo(getLocalization(LocalizationKeys.installExtensionAlreadyInstalled, id));
        return;
      }
      const result = await deps.extensions.install(id);
      if (result.exitCode !== 0) {
        deps.logger.error(`install(${id}): exit ${result.exitCode}`, result.stderr);
        void notifyError(
          getLocalization(LocalizationKeys.installExtensionFailed, id),
          { logger: deps.logger }
        );
        return;
      }
      deps.logger.info(`install(${id}): ${result.source}.`);
      deps.extensions.clearCliVersionCache();
      void deps.tree.refreshVersionInfo();
      deps.tree.refresh();
      void notifyInfo(getLocalization(LocalizationKeys.installExtensionSucceeded, id));
    }),

    vscode.commands.registerCommand(COMMANDS.uninstallExtension, async (arg?: unknown) => {
      const id = extractExtensionId(arg);
      if (!id) {
        void notifyWarn(getLocalization(LocalizationKeys.installExtensionRequiresNode));
        return;
      }
      if (!deps.extensions.isInstalled(id)) {
        void notifyInfo(getLocalization(LocalizationKeys.uninstallExtensionNotInstalled, id));
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
        ? getLocalization(LocalizationKeys.uninstallExtensionConfirm, id)
        : getLocalization(
            LocalizationKeys.uninstallExtensionCascadeConfirm,
            id,
            installedDependents.length,
            installedDependents.join(', ')
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
      const uninstalled: string[] = [];
      let failed = 0;
      for (const victim of order) {
        const result = await deps.extensions.uninstall(victim);
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
      void notifyInfo(
        installedDependents.length === 0
          ? getLocalization(LocalizationKeys.uninstallExtensionSucceeded, id)
          : getLocalization(
              LocalizationKeys.uninstallExtensionSucceededCascade,
              id,
              installedDependents.length
            )
      );
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
      // Ask VSCode to refresh its own internal "updates available" state so
      // users see the familiar Extensions-view Update badges alongside our
      // tree's arrow indicators. Our MarketplaceVersionService stays as the
      // structured source since VSCode doesn't expose per-id results to
      // callers. The native command has been on the verified-available list
      // since the Phase 5 diagnostic dump; guard anyway so a future rename
      // doesn't surface as an error toast.
      try {
        await vscode.commands.executeCommand('workbench.extensions.action.checkForUpdates');
      } catch (err) {
        deps.logger.warn(
          `workbench.extensions.action.checkForUpdates unavailable: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      deps.extensions.clearCliVersionCache();
      await deps.tree.refreshVersionInfo();
      void notifyInfo(getLocalization(LocalizationKeys.checkForUpdatesDone));
    })
  );
};
