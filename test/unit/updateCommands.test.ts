import * as vscode from 'vscode';
import { registerUpdateCommands } from '../../src/commands/updateCommands';
import { COMMANDS } from '../../src/constants';
import type { CodeCliService } from '../../src/services/codeCliService';
import type { ExtensionService } from '../../src/services/extensionService';
import type { SettingsService } from '../../src/services/settingsService';
import type { Logger } from '../../src/util/logger';
import type { GroupsTreeProvider } from '../../src/views/groupsTreeProvider';

interface RegisteredCommands {
  [commandId: string]: (...args: unknown[]) => unknown;
}

const mkContext = (): vscode.ExtensionContext =>
  ({ subscriptions: [] } as unknown as vscode.ExtensionContext);

const mkTree = (): GroupsTreeProvider => ({
  refreshVersionInfo: jest.fn(async () => undefined)
} as unknown as GroupsTreeProvider);

const mkSettings = (): SettingsService => ({
  getUpdateCheck: jest.fn(() => 'manual' as const)
} as unknown as SettingsService);

const mkLogger = (): Logger => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), dispose: jest.fn(), show: jest.fn()
} as unknown as Logger);

describe('update commands', () => {
  const captureCommands = (): RegisteredCommands => {
    const captured: RegisteredCommands = {};
    (vscode.commands.registerCommand as jest.Mock).mockImplementation(
      (id: string, handler: (...args: unknown[]) => unknown) => {
        captured[id] = handler;
        return { dispose: jest.fn() };
      }
    );
    return captured;
  };

  beforeEach(() => {
    (vscode.commands.registerCommand as jest.Mock).mockReset();
    (vscode.window.showInformationMessage as jest.Mock).mockReset();
    (vscode.window.showWarningMessage as jest.Mock).mockReset();
    (vscode.window.showErrorMessage as jest.Mock).mockReset();
    (vscode.window.withProgress as unknown) = jest.fn(
      async (_options: unknown, task: (progress: { report: jest.Mock }) => Promise<unknown>) =>
        task({ report: jest.fn() })
    );
  });

  it('updateExtension invokes CodeCliService.installExtension with force=true', async () => {
    const commands = captureCommands();
    const codeCli = {
      installExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
      uninstallExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
      listInstalledWithVersions: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
    } as unknown as CodeCliService;
    const extensions = {
      managed: jest.fn(() => []),
      clearCliVersionCache: jest.fn()
    } as unknown as ExtensionService;
    registerUpdateCommands(mkContext(), {
      codeCli,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await commands[COMMANDS.updateExtension]({ kind: 'extension', extensionId: 'salesforce.foo' });
    expect(codeCli.installExtension).toHaveBeenCalledWith('salesforce.foo', true);
  });

  it('updateExtension surfaces a warning when called without an extension arg', async () => {
    const commands = captureCommands();
    const codeCli = {
      installExtension: jest.fn(),
      uninstallExtension: jest.fn(),
      listInstalledWithVersions: jest.fn()
    } as unknown as CodeCliService;
    registerUpdateCommands(mkContext(), {
      codeCli,
      extensions: { managed: jest.fn(() => []), clearCliVersionCache: jest.fn() } as unknown as ExtensionService,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await commands[COMMANDS.updateExtension](undefined);
    expect(codeCli.installExtension).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('updateAllSalesforce reuses ExtensionService.install with force=true for every managed id', async () => {
    const commands = captureCommands();
    const installSpy = jest.fn(async () => ({ source: 'marketplace' as const, exitCode: 0 }));
    const extensions = {
      managed: jest.fn(() => [
        { id: 'salesforce.salesforcedx-vscode-apex' },
        { id: 'salesforce.salesforcedx-vscode-core' }
      ]),
      install: installSpy,
      clearCliVersionCache: jest.fn()
    } as unknown as ExtensionService;
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await commands[COMMANDS.updateAllSalesforce]();
    expect(installSpy).toHaveBeenCalledTimes(2);
    expect(installSpy).toHaveBeenNthCalledWith(1, 'salesforce.salesforcedx-vscode-apex', { force: true });
    expect(installSpy).toHaveBeenNthCalledWith(2, 'salesforce.salesforcedx-vscode-core', { force: true });
  });

  it('installExtension calls ExtensionService.install when the id is not yet installed', async () => {
    const cmds = captureCommands();
    const installed = new Set<string>();
    const extensions = {
      isInstalled: jest.fn((id: string) => installed.has(id)),
      install: jest.fn(async (id: string) => {
        installed.add(id);
        return { source: 'marketplace' as const, exitCode: 0 };
      }),
      clearCliVersionCache: jest.fn()
    } as unknown as ExtensionService;
    const tree = {
      refreshVersionInfo: jest.fn(async () => undefined),
      refresh: jest.fn()
    } as unknown as GroupsTreeProvider;
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree
    });
    await cmds[COMMANDS.installExtension]({ kind: 'extension', extensionId: 'salesforce.new' });
    expect(extensions.install).toHaveBeenCalledWith('salesforce.new');
    expect(tree.refresh).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('installExtension is a no-op when the extension is already installed', async () => {
    const cmds = captureCommands();
    const extensions = {
      isInstalled: jest.fn(() => true),
      install: jest.fn(),
      clearCliVersionCache: jest.fn()
    } as unknown as ExtensionService;
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.installExtension]({ extensionId: 'salesforce.already' });
    expect(extensions.install).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('uninstallExtension confirms, then delegates to ExtensionService.uninstall', async () => {
    const cmds = captureCommands();
    const extensions = {
      isInstalled: jest.fn(() => true),
      uninstall: jest.fn(async () => ({ exitCode: 0 })),
      clearCliVersionCache: jest.fn()
    } as unknown as ExtensionService;
    const tree = {
      refreshVersionInfo: jest.fn(async () => undefined),
      refresh: jest.fn()
    } as unknown as GroupsTreeProvider;
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Uninstall');
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree
    });
    await cmds[COMMANDS.uninstallExtension]({ extensionId: 'salesforce.goaway' });
    expect(extensions.uninstall).toHaveBeenCalledWith('salesforce.goaway');
    expect(tree.refresh).toHaveBeenCalled();
  });

  it('uninstallExtension bails when the user dismisses the confirm dialog', async () => {
    const cmds = captureCommands();
    const extensions = {
      isInstalled: jest.fn(() => true),
      uninstall: jest.fn(),
      clearCliVersionCache: jest.fn()
    } as unknown as ExtensionService;
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.uninstallExtension]({ extensionId: 'salesforce.goaway' });
    expect(extensions.uninstall).not.toHaveBeenCalled();
  });

  it('uninstallExtension reports not-installed and skips when the id is not installed', async () => {
    const cmds = captureCommands();
    const extensions = {
      isInstalled: jest.fn(() => false),
      uninstall: jest.fn(),
      clearCliVersionCache: jest.fn()
    } as unknown as ExtensionService;
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.uninstallExtension]({ extensionId: 'salesforce.never-installed' });
    expect(extensions.uninstall).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('checkForUpdates clears caches, refreshes the tree, and invokes the native workbench command', async () => {
    const commands = captureCommands();
    const tree = mkTree();
    const extensions = {
      managed: jest.fn(() => []),
      clearCliVersionCache: jest.fn()
    } as unknown as ExtensionService;
    (vscode.commands.executeCommand as jest.Mock).mockReset();
    (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree
    });
    await commands[COMMANDS.checkForUpdates]();
    expect(extensions.clearCliVersionCache).toHaveBeenCalled();
    expect(tree.refreshVersionInfo).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.extensions.action.checkForUpdates');
  });

  it('checkForUpdates still completes if the native workbench command throws', async () => {
    const commands = captureCommands();
    const tree = mkTree();
    const extensions = {
      managed: jest.fn(() => []),
      clearCliVersionCache: jest.fn()
    } as unknown as ExtensionService;
    (vscode.commands.executeCommand as jest.Mock).mockReset();
    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async (cmd: string) => {
      if (cmd === 'workbench.extensions.action.checkForUpdates') throw new Error('gone');
    });
    const logger = mkLogger();
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger,
      tree
    });
    await commands[COMMANDS.checkForUpdates]();
    expect(logger.warn).toHaveBeenCalled();
    expect(tree.refreshVersionInfo).toHaveBeenCalled();
  });
});
