import * as fs from 'fs';
import * as vscode from 'vscode';
import { COMMANDS, CONFIG_NAMESPACE, SETTINGS } from '../constants';
import { getLocalization, LocalizationKeys } from '../localization';
import { BUSY_SENTINELS, type BusyState } from '../util/busyState';
import type { ExtensionService } from '../services/extensionService';
import type { SettingsService } from '../services/settingsService';
import type { WorkspaceStateService } from '../services/workspaceStateService';
import type { Logger } from '../util/logger';
import type { VsixInstaller } from '../vsix/vsixInstaller';
import type { VsixScanner } from '../vsix/vsixScanner';
import type { GroupsTreeProvider } from '../views/groupsTreeProvider';
import type { VsixTreeProvider } from '../views/vsixTreeProvider';

interface Deps {
  scanner: VsixScanner;
  installer: VsixInstaller;
  extensions: ExtensionService;
  settings: SettingsService;
  workspaceState: WorkspaceStateService;
  logger: Logger;
  groupsTree: GroupsTreeProvider;
  vsixTree: VsixTreeProvider;
  busy?: BusyState;
}

/**
 * Commands like `removeVsixOverride` are dispatched from the VSIX
 * tree's row context menu. VSCode hands the `VsixNode` to the
 * handler; this extracts the filePath regardless of whether the
 * caller passed the node, a string, or nothing.
 */
interface VsixNodeContext {
  kind?: 'vsix';
  filePath?: string;
  extensionId?: string;
}

const extractVsixArgs = (arg: unknown): { filePath?: string; extensionId?: string } => {
  if (typeof arg === 'string') return { filePath: arg };
  if (!arg || typeof arg !== 'object') return {};
  const node = arg as VsixNodeContext;
  return { filePath: node.filePath, extensionId: node.extensionId };
};

const withBusy = async <T>(
  deps: Deps,
  ids: readonly string[],
  fn: () => Promise<T>
): Promise<T> => (deps.busy ? deps.busy.withBusy(ids, fn) : fn());

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
      const overrideIds = [...overrides.keys()];
      await withBusy(deps, [BUSY_SENTINELS.vsixRefresh, ...overrideIds], async () => {
        let ok = 0;
        let failed = 0;
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: getLocalization(LocalizationKeys.vsixReinstallProgressTitle)
          },
          async () => {
            for (const id of overrideIds) {
              const outcome = await deps.installer.tryInstall(id);
              if (outcome === 'vsix') ok++;
              else failed++;
            }
          }
        );
        deps.groupsTree.refresh();
        if (failed) {
          void vscode.window.showWarningMessage(
            getLocalization(LocalizationKeys.vsixRefreshSummaryFailed, ok, failed)
          );
        } else {
          // Success: the tree re-renders with `$(package)` badges on every
          // VSIX-sourced row. No toast needed.
          deps.logger.info(`vsixRefresh: reinstalled ${ok} from VSIX directory.`);
        }
      });
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
      // Success: VSIX badges disappear from the tree and the status-bar
      // VSIX item hides itself. The modal above already asked for
      // explicit confirmation.
      deps.logger.info(`clearVsixOverrides: reinstalled ${ids.length} from marketplace.`);
    }),

    vscode.commands.registerCommand(COMMANDS.revealVsixFile, async (arg?: unknown) => {
      const { filePath } = extractVsixArgs(arg);
      const target = filePath ?? deps.scanner.getDirectory();
      if (!target) return;
      // Reveals in the OS file explorer. Works for both a specific
      // .vsix and the override directory as a fallback.
      try {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
      } catch {
        await vscode.env.openExternal(vscode.Uri.file(target));
      }
    }),

    vscode.commands.registerCommand(COMMANDS.removeVsixOverride, async (arg?: unknown) => {
      const { filePath } = extractVsixArgs(arg);
      if (!filePath) return;
      const filename = filePath.split('/').pop() ?? filePath;
      const proceed = getLocalization(LocalizationKeys.vsixRemoveProceed);
      const confirm = await vscode.window.showWarningMessage(
        getLocalization(LocalizationKeys.vsixRemoveConfirm, filename),
        { modal: true },
        proceed
      );
      if (confirm !== proceed) return;
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        deps.logger.warn(
          `vsix: remove ${filePath} failed (${err instanceof Error ? err.message : String(err)})`
        );
        return;
      }
      deps.logger.info(`vsix: removed override file ${filePath}`);
      // File-system watcher fires on unlink and drives the same
      // refresh/auto-install path, but force a refresh here so the
      // view updates without depending on watcher latency.
      deps.vsixTree.refresh();
      deps.groupsTree.refresh();
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
