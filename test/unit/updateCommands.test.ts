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

/**
 * Most tests here don't care about display-name resolution — they just need
 * the label helper to exist on the stubbed service. Default behavior is
 * identity (label(id) === id); individual tests override `labels` when they
 * want to assert that notification copy uses the display name.
 */
const makeLabel = (labels?: Map<string, string>) =>
  jest.fn((id: string) => labels?.get(id) ?? id);

const mkContext = (): vscode.ExtensionContext =>
  ({ subscriptions: [] } as unknown as vscode.ExtensionContext);

const mkTree = (): GroupsTreeProvider => ({
  refreshVersionInfo: jest.fn(async () => undefined),
  refresh: jest.fn()
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
      label: makeLabel(),
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
      label: makeLabel(),
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
      label: makeLabel(),
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

  // Shared test doubles for the dep-graph surface that uninstallExtension
  // now consults. Tests can override `dependents` or `graph` via spread.
  const mkExtensionsForUninstall = (overrides: Record<string, unknown> = {}): ExtensionService => ({
    isInstalled: jest.fn(() => true),
    uninstall: jest.fn(async () => ({ exitCode: 0 })),
    label: makeLabel(),
    clearCliVersionCache: jest.fn(),
    getDependencyGraph: jest.fn(() => new Map()),
    transitiveDependents: jest.fn(() => new Set<string>()),
    topologicalUninstallOrder: jest.fn((ids: readonly string[]) => [...ids]),
    ...overrides
  } as unknown as ExtensionService);

  it('uninstallExtension confirms, then delegates to ExtensionService.uninstall', async () => {
    const cmds = captureCommands();
    const extensions = mkExtensionsForUninstall();
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

  it('uninstallExtension cascades to transitive dependents in topological order', async () => {
    // Regression for: "Cannot uninstall 'Apex' extension. 'Apex OpenAPI
    // Specification' and 'Apex Replay Debugger' extensions depend on this."
    // Uninstalling apex must first remove its dependents.
    const cmds = captureCommands();
    const uninstallCalls: string[] = [];
    const extensions = mkExtensionsForUninstall({
      transitiveDependents: jest.fn(
        () => new Set(['salesforce.apex-oas', 'salesforce.apex-replay-debugger'])
      ),
      topologicalUninstallOrder: jest.fn((ids: readonly string[]) => {
        // Simulate the real topological ordering: dependents come off
        // before the root. Root is the last id passed to victims above.
        const rooted = new Set(ids);
        const order: string[] = [];
        for (const id of ['salesforce.apex-oas', 'salesforce.apex-replay-debugger', 'salesforce.apex']) {
          if (rooted.has(id)) order.push(id);
        }
        return order;
      }),
      uninstall: jest.fn(async (id: string) => { uninstallCalls.push(id); return { exitCode: 0 }; })
    });
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue('Uninstall');
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.uninstallExtension]({ extensionId: 'salesforce.apex' });
    expect(uninstallCalls).toEqual([
      'salesforce.apex-oas',
      'salesforce.apex-replay-debugger',
      'salesforce.apex'
    ]);
  });

  it('uninstallExtension bails when the user dismisses the cascade confirm dialog', async () => {
    const cmds = captureCommands();
    const extensions = mkExtensionsForUninstall({
      transitiveDependents: jest.fn(() => new Set(['salesforce.dependent']))
    });
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.uninstallExtension]({ extensionId: 'salesforce.apex' });
    expect(extensions.uninstall).not.toHaveBeenCalled();
  });

  it('uninstallExtension bails when the user dismisses the confirm dialog (no dependents)', async () => {
    const cmds = captureCommands();
    const extensions = mkExtensionsForUninstall({ uninstall: jest.fn() });
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
      label: makeLabel(),
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

  it('openInMarketplace invokes the built-in extension.open command for the selected id', async () => {
    const cmds = captureCommands();
    const extensions = mkExtensionsForUninstall();
    (vscode.commands.executeCommand as jest.Mock).mockReset();
    (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.openInMarketplace]({ extensionId: 'salesforce.salesforcedx-einstein-gpt' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'extension.open',
      'salesforce.salesforcedx-einstein-gpt'
    );
  });

  it('openInMarketplace picks up marketplaceExtensionId from a pack group node', async () => {
    // view/item/context hands the entire GroupsNode to the command when the
    // user clicks the inline button on a pack group row. extractExtensionId
    // must descend into `group.marketplaceExtensionId` so the pack's own id
    // (e.g. salesforce.salesforcedx-vscode) gets opened.
    const cmds = captureCommands();
    (vscode.commands.executeCommand as jest.Mock).mockReset();
    (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions: mkExtensionsForUninstall(),
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.openInMarketplace]({
      kind: 'group',
      isActive: false,
      group: {
        id: 'salesforce-extension-pack',
        label: 'Salesforce Extension Pack',
        extensions: [],
        builtIn: true,
        marketplaceExtensionId: 'salesforce.salesforcedx-vscode'
      }
    });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'extension.open',
      'salesforce.salesforcedx-vscode'
    );
  });

  it('openInMarketplace surfaces a warning when no extension id is provided', async () => {
    const cmds = captureCommands();
    (vscode.commands.executeCommand as jest.Mock).mockReset();
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions: mkExtensionsForUninstall(),
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.openInMarketplace](undefined);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('extension.open', expect.anything());
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('checkForUpdates clears caches and refreshes the tree via our own probe', async () => {
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
  });

  it('installExtension notification uses the display name when known', async () => {
    const cmds = captureCommands();
    const installed = new Set<string>();
    const extensions = {
      isInstalled: jest.fn((id: string) => installed.has(id)),
      install: jest.fn(async (id: string) => {
        installed.add(id);
        return { source: 'marketplace' as const, exitCode: 0 };
      }),
      label: makeLabel(new Map([['salesforce.salesforcedx-einstein-gpt', 'Agentforce Vibes']])),
      clearCliVersionCache: jest.fn()
    } as unknown as ExtensionService;
    (vscode.window.showInformationMessage as jest.Mock).mockReset();
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.installExtension]({ extensionId: 'salesforce.salesforcedx-einstein-gpt' });
    const messages = (vscode.window.showInformationMessage as jest.Mock).mock.calls.map(c => c[0]);
    expect(messages.some(m => typeof m === 'string' && m.includes('Agentforce Vibes'))).toBe(true);
    expect(messages.every(m => typeof m !== 'string' || !m.includes('salesforce.salesforcedx-einstein-gpt'))).toBe(true);
  });

  it('installExtension notification falls back to the raw id when no display name is known', async () => {
    const cmds = captureCommands();
    const installed = new Set<string>();
    const extensions = {
      isInstalled: jest.fn((id: string) => installed.has(id)),
      install: jest.fn(async (id: string) => {
        installed.add(id);
        return { source: 'marketplace' as const, exitCode: 0 };
      }),
      label: makeLabel(),
      clearCliVersionCache: jest.fn()
    } as unknown as ExtensionService;
    (vscode.window.showInformationMessage as jest.Mock).mockReset();
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.installExtension]({ extensionId: 'salesforce.obscure' });
    const messages = (vscode.window.showInformationMessage as jest.Mock).mock.calls.map(c => c[0]);
    expect(messages.some(m => typeof m === 'string' && m.includes('salesforce.obscure'))).toBe(true);
  });

  it('uninstallExtension cascade prompt lists dependents by display name', async () => {
    const cmds = captureCommands();
    const extensions = mkExtensionsForUninstall({
      transitiveDependents: jest.fn(
        () => new Set(['salesforce.salesforcedx-vscode-apex-oas'])
      ),
      label: makeLabel(
        new Map([
          ['salesforce.salesforcedx-vscode-apex', 'Apex'],
          ['salesforce.salesforcedx-vscode-apex-oas', 'Apex OpenAPI Specification']
        ])
      )
    });
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
    registerUpdateCommands(mkContext(), {
      codeCli: { installExtension: jest.fn(), uninstallExtension: jest.fn(), listInstalledWithVersions: jest.fn() } as unknown as CodeCliService,
      extensions,
      settings: mkSettings(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.uninstallExtension]({ extensionId: 'salesforce.salesforcedx-vscode-apex' });
    const prompt = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0] as string;
    expect(prompt).toContain('Apex');
    expect(prompt).toContain('Apex OpenAPI Specification');
    // Cascade member should render as a display name, not the raw id.
    expect(prompt).not.toContain('salesforce.salesforcedx-vscode-apex-oas');
  });

  it('checkForUpdates does not fire the native workbench "check for updates" modal', async () => {
    // VSCode's workbench.extensions.action.checkForUpdates pops a modal
    // dialog we can't suppress ("All extensions are up to date."). Users
    // invoking our command want our tree refreshed, not that dialog, so
    // we intentionally skip it.
    const commands = captureCommands();
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
      tree: mkTree()
    });
    await commands[COMMANDS.checkForUpdates]();
    const calls = (vscode.commands.executeCommand as jest.Mock).mock.calls;
    expect(
      calls.some(c => c[0] === 'workbench.extensions.action.checkForUpdates')
    ).toBe(false);
  });
});
