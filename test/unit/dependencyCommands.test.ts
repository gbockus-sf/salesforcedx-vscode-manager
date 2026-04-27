import { describe, expect, it, jest } from '@jest/globals';
import * as vscode from 'vscode';
import { registerDependencyCommands } from '../../src/commands/dependencyCommands';
import { COMMANDS } from '../../src/constants';
import type { DependencyRegistry } from '../../src/dependencies/registry';
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
});
