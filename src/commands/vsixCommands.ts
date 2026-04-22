import * as vscode from 'vscode';
import { COMMANDS, CONFIG_NAMESPACE, SETTINGS } from '../constants';
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
        const pick = await vscode.window.showWarningMessage(
          'VSIX directory is not configured.',
          'Open Settings'
        );
        if (pick === 'Open Settings') {
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
          `No .vsix files found in ${deps.scanner.getDirectory()}.`
        );
        return;
      }
      let ok = 0;
      let failed = 0;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Reinstalling from VSIX directory…' },
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
        `Refreshed from VSIX directory: ${ok} installed${failed ? ` · ${failed} failed` : ''}.`
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
        void vscode.window.showInformationMessage('No VSIX-sourced extensions to clear.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Uninstall ${count} VSIX-sourced extension(s) and reinstall from marketplace?`,
        { modal: true },
        'Proceed'
      );
      if (confirm !== 'Proceed') return;
      const ids = await deps.installer.clearAllOverrides();
      deps.groupsTree.refresh();
      void vscode.window.showInformationMessage(`Reinstalled ${ids.length} extension(s) from marketplace.`);
    }),

    vscode.commands.registerCommand(COMMANDS.vsixMenu, async () => {
      const configured = deps.scanner.isConfigured();
      const dir = deps.scanner.getDirectory();
      const options: Array<vscode.QuickPickItem & { action: string }> = [
        {
          label: configured ? '$(folder) Open VSIX Directory' : '$(gear) Configure VSIX Directory',
          description: configured ? dir : 'not set',
          action: 'open'
        },
        ...(configured
          ? [
              { label: '$(refresh) Refresh from VSIX Directory', action: 'refresh' } as const,
              { label: '$(trash) Clear VSIX Overrides', action: 'clear' } as const
            ]
          : []),
        { label: '$(gear) Change VSIX Directory...', action: 'change' }
      ];
      const pick = await vscode.window.showQuickPick(options, { placeHolder: 'VSIX management' });
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
