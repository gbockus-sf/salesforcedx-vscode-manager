import * as vscode from 'vscode';
import { COMMANDS, CONFIG_NAMESPACE, SETTINGS } from '../constants';
import { getLocalization, LocalizationKeys } from '../localization';
import type { ExtensionService } from '../services/extensionService';
import type { SettingsService } from '../services/settingsService';
import type { WorkspaceStateService } from '../services/workspaceStateService';
import type { Logger } from '../util/logger';
import type { VsixInstaller } from '../vsix/vsixInstaller';
import type { VsixScanner } from '../vsix/vsixScanner';
import type { GroupsTreeProvider } from '../views/groupsTreeProvider';

interface Deps {
  scanner: VsixScanner;
  installer: VsixInstaller;
  extensions: ExtensionService;
  settings: SettingsService;
  workspaceState: WorkspaceStateService;
  logger: Logger;
  groupsTree: GroupsTreeProvider;
}

export const registerVsixCommands = (
  context: vscode.ExtensionContext,
  deps: Deps
): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.refreshFromVsixDirectory, async () => {
      if (!deps.scanner.isConfigured()) {
        const openSettings = getLocalization(LocalizationKeys.vsixDirectoryNotConfiguredOpenSettings);
        const pick = await vscode.window.showWarningMessage(
          getLocalization(LocalizationKeys.vsixDirectoryNotConfigured),
          openSettings
        );
        if (pick === openSettings) {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            `${CONFIG_NAMESPACE}.${SETTINGS.vsixDirectory}`
          );
        }
        return;
      }
      const overrides = deps.scanner.scan();
      if (overrides.size === 0) {
        void vscode.window.showInformationMessage(
          getLocalization(LocalizationKeys.vsixNoFilesFound, deps.scanner.getDirectory())
        );
        return;
      }
      let ok = 0;
      let failed = 0;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: getLocalization(LocalizationKeys.vsixReinstallProgressTitle)
        },
        async () => {
          for (const id of overrides.keys()) {
            const outcome = await deps.installer.tryInstall(id);
            if (outcome === 'vsix') ok++;
            else failed++;
          }
        }
      );
      deps.groupsTree.refresh();
      void vscode.window.showInformationMessage(
        failed
          ? getLocalization(LocalizationKeys.vsixRefreshSummaryFailed, ok, failed)
          : getLocalization(LocalizationKeys.vsixRefreshSummaryOk, ok)
      );
    }),

    vscode.commands.registerCommand(COMMANDS.openVsixDirectory, async () => {
      const dir = deps.scanner.getDirectory();
      if (!dir) {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          `${CONFIG_NAMESPACE}.${SETTINGS.vsixDirectory}`
        );
        return;
      }
      await vscode.env.openExternal(vscode.Uri.file(dir));
    }),

    vscode.commands.registerCommand(COMMANDS.clearVsixOverrides, async () => {
      const sources = deps.installer.currentSources();
      const count = Object.values(sources).filter(s => s === 'vsix').length;
      if (count === 0) {
        void vscode.window.showInformationMessage(getLocalization(LocalizationKeys.vsixNoOverrides));
        return;
      }
      const proceed = getLocalization(LocalizationKeys.vsixClearProceed);
      const confirm = await vscode.window.showWarningMessage(
        getLocalization(LocalizationKeys.vsixClearConfirm, count),
        { modal: true },
        proceed
      );
      if (confirm !== proceed) return;
      const ids = await deps.installer.clearAllOverrides();
      deps.groupsTree.refresh();
      void vscode.window.showInformationMessage(
        getLocalization(LocalizationKeys.vsixReinstalledFromMarketplace, ids.length)
      );
    }),

    vscode.commands.registerCommand(COMMANDS.vsixMenu, async () => {
      const configured = deps.scanner.isConfigured();
      const dir = deps.scanner.getDirectory();
      const options: Array<vscode.QuickPickItem & { action: string }> = [
        {
          label: configured
            ? getLocalization(LocalizationKeys.vsixMenuOpenConfigured)
            : getLocalization(LocalizationKeys.vsixMenuOpenUnconfigured),
          description: configured ? dir : getLocalization(LocalizationKeys.vsixMenuNotSet),
          action: 'open'
        },
        ...(configured
          ? [
              { label: getLocalization(LocalizationKeys.vsixMenuRefresh), action: 'refresh' } as const,
              { label: getLocalization(LocalizationKeys.vsixMenuClear), action: 'clear' } as const
            ]
          : []),
        { label: getLocalization(LocalizationKeys.vsixMenuChange), action: 'change' }
      ];
      const pick = await vscode.window.showQuickPick(options, {
        placeHolder: getLocalization(LocalizationKeys.vsixMenuPlaceholder)
      });
      if (!pick) return;
      switch (pick.action) {
        case 'open':
          await vscode.commands.executeCommand(
            configured ? COMMANDS.openVsixDirectory : 'workbench.action.openSettings',
            configured ? undefined : `${CONFIG_NAMESPACE}.${SETTINGS.vsixDirectory}`
          );
          break;
        case 'refresh':
          await vscode.commands.executeCommand(COMMANDS.refreshFromVsixDirectory);
          break;
        case 'clear':
          await vscode.commands.executeCommand(COMMANDS.clearVsixOverrides);
          break;
        case 'change':
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            `${CONFIG_NAMESPACE}.${SETTINGS.vsixDirectory}`
          );
          break;
      }
    })
  );
};
