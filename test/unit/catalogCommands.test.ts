import * as vscode from 'vscode';
import { registerCatalogCommands } from '../../src/commands/catalogCommands';
import { COMMANDS } from '../../src/constants';
import type { CatalogEntry } from '../../src/services/marketplaceVersionService';
import type { ExtensionService, InstallOutcome } from '../../src/services/extensionService';
import type { PublisherCatalogService } from '../../src/services/publisherCatalogService';
import type { Logger } from '../../src/util/logger';
import type { GroupsTreeProvider } from '../../src/views/groupsTreeProvider';

interface RegisteredCommands {
  [commandId: string]: (...args: unknown[]) => unknown;
}

const mkContext = (): vscode.ExtensionContext =>
  ({ subscriptions: [] } as unknown as vscode.ExtensionContext);

const mkTree = (): GroupsTreeProvider => ({
  refresh: jest.fn()
} as unknown as GroupsTreeProvider);

const mkLogger = (): Logger => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), dispose: jest.fn(), show: jest.fn()
} as unknown as Logger);

const entry = (id: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  extensionId: id,
  displayName: id,
  shortDescription: undefined,
  categories: [],
  version: undefined,
  installCount: undefined,
  ...extra
});

const mkCatalog = (entries: CatalogEntry[]): PublisherCatalogService => {
  let current = entries;
  return {
    current: jest.fn(() => current),
    refresh: jest.fn(async () => { current = entries; }),
    getPublisher: jest.fn(() => 'salesforce'),
    getLastRefreshedAt: jest.fn(() => Date.now()),
    clear: jest.fn()
  } as unknown as PublisherCatalogService;
};

describe('catalog commands', () => {
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
    (vscode.window.showQuickPick as jest.Mock).mockReset();
    (vscode.window.withProgress as unknown) = jest.fn(
      async (
        _options: unknown,
        task: (progress: { report: jest.Mock }) => Promise<unknown>
      ) => task({ report: jest.fn() })
    );
  });

  it('refreshSalesforceCatalog refreshes the tree and stays silent on success', async () => {
    // Per the default-no-toast rule: the catalog group re-renders with
    // its new member count, so no notification is needed. The user hit
    // "refresh", the tree updates — that's the feedback.
    const cmds = captureCommands();
    const catalog = mkCatalog([entry('salesforce.a'), entry('salesforce.b')]);
    const tree = mkTree();
    registerCatalogCommands(mkContext(), {
      catalog,
      extensions: { managed: jest.fn(() => []) } as unknown as ExtensionService,
      logger: mkLogger(),
      tree
    });
    await cmds[COMMANDS.refreshSalesforceCatalog]();
    expect(catalog.refresh).toHaveBeenCalledWith({ force: true });
    expect(tree.refresh).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('refreshSalesforceCatalog warns when the marketplace returns nothing', async () => {
    // Empty result usually means offline / network failure — keep a
    // toast so the user knows the tree didn't refresh meaningfully.
    const cmds = captureCommands();
    const catalog = mkCatalog([]);
    registerCatalogCommands(mkContext(), {
      catalog,
      extensions: { managed: jest.fn(() => []) } as unknown as ExtensionService,
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.refreshSalesforceCatalog]();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('browseSalesforceExtensions prompts with every catalog entry and installs the picks', async () => {
    const cmds = captureCommands();
    const catalog = mkCatalog([entry('salesforce.apex'), entry('salesforce.core')]);
    const install = jest.fn(
      async (): Promise<InstallOutcome> => ({ source: 'marketplace', exitCode: 0 })
    );
    const extensions = {
      managed: jest.fn(() => []),
      install,
      label: jest.fn((id: string) => id)
    } as unknown as ExtensionService;
    registerCatalogCommands(mkContext(), {
      catalog,
      extensions,
      logger: mkLogger(),
      tree: mkTree()
    });
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue([
      { extensionId: 'salesforce.apex' },
      { extensionId: 'salesforce.core' }
    ]);
    await cmds[COMMANDS.browseSalesforceExtensions]();
    expect(install).toHaveBeenCalledTimes(2);
    expect(install).toHaveBeenCalledWith('salesforce.apex');
    expect(install).toHaveBeenCalledWith('salesforce.core');
  });

  it('browseSalesforceExtensions warns when the catalog is empty', async () => {
    const cmds = captureCommands();
    const catalog = mkCatalog([]);
    registerCatalogCommands(mkContext(), {
      catalog,
      extensions: { managed: jest.fn(() => []) } as unknown as ExtensionService,
      logger: mkLogger(),
      tree: mkTree()
    });
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);
    await cmds[COMMANDS.browseSalesforceExtensions]();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('browseSalesforceExtensions bails out cleanly when the user dismisses the picker', async () => {
    const cmds = captureCommands();
    const catalog = mkCatalog([entry('salesforce.apex')]);
    const install = jest.fn();
    registerCatalogCommands(mkContext(), {
      catalog,
      extensions: {
        managed: jest.fn(() => []),
        install
      } as unknown as ExtensionService,
      logger: mkLogger(),
      tree: mkTree()
    });
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);
    await cmds[COMMANDS.browseSalesforceExtensions]();
    expect(install).not.toHaveBeenCalled();
  });
});
