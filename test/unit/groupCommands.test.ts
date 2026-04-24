/**
 * Focused coverage for src/commands/groupCommands.ts. Only the paths
 * not already exercised by the broader `groupApplier` tests and the
 * telemetry / notifications audits get tested here — today that's the
 * post-apply dependency-check hook. Keeping the suite tight so we
 * don't re-assert the applier's contract at the command layer.
 */

import * as vscode from 'vscode';

// Mock the applier so tests can drive its return value without spinning
// up real services. Has to come BEFORE the groupCommands import.
jest.mock('../../src/groups/groupApplier', () => ({
  applyGroup: jest.fn()
}));
import { applyGroup } from '../../src/groups/groupApplier';

import { registerGroupCommands } from '../../src/commands/groupCommands';
import { COMMANDS } from '../../src/constants';
import type { GroupStore } from '../../src/groups/groupStore';
import type { ExtensionService } from '../../src/services/extensionService';
import type { SettingsService } from '../../src/services/settingsService';
import type { WorkspaceStateService } from '../../src/services/workspaceStateService';
import type { Logger } from '../../src/util/logger';
import type { GroupsTreeProvider } from '../../src/views/groupsTreeProvider';

interface RegisteredCommands {
  [commandId: string]: (...args: unknown[]) => unknown;
}

const mkContext = (): vscode.ExtensionContext =>
  ({ subscriptions: [] } as unknown as vscode.ExtensionContext);

const mkStore = (): GroupStore =>
  ({ get: jest.fn(), list: jest.fn(() => []) } as unknown as GroupStore);

const mkTree = (): GroupsTreeProvider =>
  ({ refresh: jest.fn() } as unknown as GroupsTreeProvider);

const mkSettings = (): SettingsService =>
  ({
    getApplyScope: jest.fn(() => 'disableOthers'),
    getReloadAfterApply: jest.fn(() => 'never')
  } as unknown as SettingsService);

const mkWorkspaceState = (): WorkspaceStateService =>
  ({
    getApplyScopeChoice: jest.fn(() => undefined),
    setApplyScopeChoice: jest.fn(async () => undefined),
    setActiveGroupId: jest.fn(async () => undefined)
  } as unknown as WorkspaceStateService);

const mkLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger);

const mkExtensions = (): ExtensionService =>
  ({
    managed: jest.fn(() => [{ id: 'salesforce.a' } as unknown as { id: string }]),
    showManualToggleHint: jest.fn(async () => undefined)
  } as unknown as ExtensionService);

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

const emptyResult = (): Awaited<ReturnType<typeof applyGroup>> => ({
  enabled: [],
  disabled: [],
  installedFromVsix: [],
  needsManualEnable: [],
  needsManualDisable: [],
  dependencyBlocked: [],
  dependencyAutoIncluded: [],
  skipped: []
});

describe('post-apply dependency check', () => {
  beforeEach(() => {
    (vscode.commands.registerCommand as jest.Mock).mockReset();
    (vscode.commands.executeCommand as jest.Mock).mockReset();
    (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
    (applyGroup as jest.Mock).mockReset();
  });

  it('fires runDependencyCheck when apply touched state', async () => {
    // Users expect to know about missing prerequisites BEFORE trying
    // to use the freshly-enabled extensions.
    (applyGroup as jest.Mock).mockResolvedValueOnce({
      ...emptyResult(),
      enabled: ['salesforce.a']
    });
    const cmds = captureCommands();
    const group = { id: 'apex', label: 'Apex', extensions: ['salesforce.a'], builtIn: true };
    registerGroupCommands(mkContext(), {
      store: { ...mkStore(), get: jest.fn(() => group) } as unknown as GroupStore,
      extensions: mkExtensions(),
      settings: mkSettings(),
      workspaceState: mkWorkspaceState(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.applyGroup]('apex');
    const calls = (vscode.commands.executeCommand as jest.Mock).mock.calls;
    expect(calls.some(c => c[0] === COMMANDS.runDependencyCheck)).toBe(true);
  });

  it('skips runDependencyCheck when the apply is a no-op', async () => {
    // A re-apply that didn't change anything shouldn't cost the user a
    // dependency-probe tax — the last check's state is still valid.
    (applyGroup as jest.Mock).mockResolvedValueOnce(emptyResult());
    const cmds = captureCommands();
    const group = { id: 'apex', label: 'Apex', extensions: ['salesforce.a'], builtIn: true };
    registerGroupCommands(mkContext(), {
      store: { ...mkStore(), get: jest.fn(() => group) } as unknown as GroupStore,
      extensions: mkExtensions(),
      settings: mkSettings(),
      workspaceState: mkWorkspaceState(),
      logger: mkLogger(),
      tree: mkTree()
    });
    await cmds[COMMANDS.applyGroup]('apex');
    const calls = (vscode.commands.executeCommand as jest.Mock).mock.calls;
    expect(calls.some(c => c[0] === COMMANDS.runDependencyCheck)).toBe(false);
  });
});
