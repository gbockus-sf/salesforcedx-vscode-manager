import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
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
        void vscode.window.showWarningMessage(
          'SFDX Manager: Update requires an extension node to be selected in the Groups tree.'
        );
        return;
      }
      const { exitCode, stderr } = await deps.codeCli.installExtension(id, true);
      if (exitCode !== 0) {
        deps.logger.error(`update(${id}): exit ${exitCode}`, stderr);
        void vscode.window.showErrorMessage(`Failed to update ${id}. See SFDX Manager log.`);
        return;
      }
      deps.logger.info(`update(${id}): reinstalled with --force.`);
      deps.extensions.clearCliVersionCache();
      void deps.tree.refreshVersionInfo();
      void vscode.window.showInformationMessage(`Updated ${id}.`);
    }),

    vscode.commands.registerCommand(COMMANDS.updateAllSalesforce, async () => {
      const ids = deps.extensions.managed().map(e => e.id);
      if (ids.length === 0) {
        void vscode.window.showInformationMessage('No managed extensions to update.');
        return;
      }
      let ok = 0;
      let failed = 0;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Updating managed Salesforce extensions…'
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
      void vscode.window.showInformationMessage(
        `Update complete: ${ok} succeeded${failed ? ` · ${failed} failed` : ''}.`
      );
    }),

    vscode.commands.registerCommand(COMMANDS.checkForUpdates, async () => {
      deps.extensions.clearCliVersionCache();
      await deps.tree.refreshVersionInfo();
      void vscode.window.showInformationMessage('SFDX Manager: update check complete.');
    })
  );
};
