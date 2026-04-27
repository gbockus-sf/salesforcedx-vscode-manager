import { describe, expect, it, jest } from '@jest/globals';
import * as vscode from 'vscode';
import { registerDependencyCommands } from '../../src/commands/dependencyCommands';
import { COMMANDS } from '../../src/constants';
import type { DependencyRegistry } from '../../src/dependencies/registry';
import type { CliVersionService } from '../../src/services/cliVersionService';
import type { Logger } from '../../src/util/logger';
import type { DependenciesTreeProvider } from '../../src/views/dependenciesTreeProvider';

interface RegisteredCommands {
  [commandId: string]: (...args: unknown[]) => unknown;
}

const mkContext = (): vscode.ExtensionContext =>
  ({ subscriptions: [] } as unknown as vscode.ExtensionContext);

const captureCommands = (): RegisteredCommands => {
  const captured: RegisteredCommands = {};
  (vscode.commands.registerCommand as jest.Mock).mockImplementation(((
    id: string,
    handler: (...args: unknown[]) => unknown
  ) => {
    captured[id] = handler;
    return { dispose: jest.fn() };
  }) as unknown as () => unknown);
  return captured;
};

describe('upgradeCli command', () => {
  beforeEach(() => {
    (vscode.commands.registerCommand as jest.Mock).mockReset();
    (vscode.window.createTerminal as jest.Mock).mockReset();
    (vscode.window.onDidCloseTerminal as jest.Mock).mockReset();
    (vscode.window.onDidCloseTerminal as jest.Mock).mockReturnValue({ dispose: jest.fn() });
  });

  it('opens a dedicated terminal and runs `sf update`', async () => {
    // User sees the output of the update in real time; no silent
    // shell-out, no attempted heuristics about install path.
    const fakeTerminal = { show: jest.fn(), sendText: jest.fn(), dispose: jest.fn() };
    (vscode.window.createTerminal as jest.Mock).mockReturnValue(fakeTerminal);
    const cmds = captureCommands();
    registerDependencyCommands(mkContext(), {
      registry: {} as unknown as DependencyRegistry,
      tree: {} as unknown as DependenciesTreeProvider,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger
    });
    await cmds[COMMANDS.upgradeCli]();
    expect(vscode.window.createTerminal).toHaveBeenCalled();
    expect(fakeTerminal.show).toHaveBeenCalled();
    expect(fakeTerminal.sendText).toHaveBeenCalledWith('sf update');
  });

  it('re-probes the CLI version and re-runs the sf-cli check when the upgrade terminal closes', async () => {
    // Regression for: `sf update` ran successfully but the tree +
    // status-bar kept showing the old "update available" state
    // because nothing refreshed the cached answer.
    const fakeTerminal = { show: jest.fn(), sendText: jest.fn(), dispose: jest.fn() };
    (vscode.window.createTerminal as jest.Mock).mockReturnValue(fakeTerminal);
    const closeListeners: ((t: unknown) => Promise<void> | void)[] = [];
    (vscode.window.onDidCloseTerminal as jest.Mock).mockImplementation(((
      listener: (t: unknown) => Promise<void> | void
    ) => {
      closeListeners.push(listener);
      return { dispose: jest.fn() };
    }) as unknown as () => unknown);

    const cliVersion = {
      clearCache: jest.fn(),
      getLatestVersion: jest.fn(async () => undefined)
    } as unknown as CliVersionService;
    const tree = {
      setCliLatestVersion: jest.fn(),
      runOne: jest.fn(async () => undefined)
    } as unknown as DependenciesTreeProvider;

    const cmds = captureCommands();
    registerDependencyCommands(mkContext(), {
      registry: {} as unknown as DependencyRegistry,
      tree,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger,
      cliVersion
    });
    await cmds[COMMANDS.upgradeCli]();

    // Closing a *different* terminal is a no-op; only OUR terminal
    // triggers the refresh.
    await closeListeners[0]({ name: 'some other terminal' });
    expect(cliVersion.clearCache).not.toHaveBeenCalled();

    await closeListeners[0](fakeTerminal);
    expect(cliVersion.clearCache).toHaveBeenCalled();
    expect(cliVersion.getLatestVersion).toHaveBeenCalled();
    expect(tree.setCliLatestVersion).toHaveBeenCalledWith(undefined);
    expect(tree.runOne).toHaveBeenCalledWith('builtin.sf-cli');
  });
});

describe('refreshCliVersion command', () => {
  beforeEach(() => {
    (vscode.commands.registerCommand as jest.Mock).mockReset();
    (vscode.window.onDidCloseTerminal as jest.Mock).mockReset();
    (vscode.window.onDidCloseTerminal as jest.Mock).mockReturnValue({ dispose: jest.fn() });
  });

  it('clears the CLI cache and re-runs the sf-cli check on demand', async () => {
    // Manual escape hatch — users who run `sf update` outside our
    // terminal, or edit PATH, can use the palette command to flush
    // the stale state without waiting for the 1 h cache TTL.
    const cliVersion = {
      clearCache: jest.fn(),
      getLatestVersion: jest.fn(async () => undefined)
    } as unknown as CliVersionService;
    const tree = {
      setCliLatestVersion: jest.fn(),
      runOne: jest.fn(async () => undefined)
    } as unknown as DependenciesTreeProvider;

    const cmds = captureCommands();
    registerDependencyCommands(mkContext(), {
      registry: {} as unknown as DependencyRegistry,
      tree,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger,
      cliVersion
    });
    await cmds[COMMANDS.refreshCliVersion]();
    expect(cliVersion.clearCache).toHaveBeenCalled();
    expect(tree.runOne).toHaveBeenCalledWith('builtin.sf-cli');
  });
});
