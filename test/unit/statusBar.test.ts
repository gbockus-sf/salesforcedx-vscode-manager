import * as vscode from 'vscode';
import { GroupStatusBarItem } from '../../src/statusBar/groupStatusBarItem';
import { VsixStatusBarItem } from '../../src/statusBar/vsixStatusBarItem';
import type { GroupStore } from '../../src/groups/groupStore';
import type { SettingsService } from '../../src/services/settingsService';
import type { WorkspaceStateService } from '../../src/services/workspaceStateService';
import type { VsixInstaller } from '../../src/vsix/vsixInstaller';

interface FakeItem {
  text: string;
  tooltip: string;
  command: string;
  show: jest.Mock;
  hide: jest.Mock;
  dispose: jest.Mock;
  backgroundColor?: unknown;
}

const newFakeItem = (): FakeItem => ({
  text: '',
  tooltip: '',
  command: '',
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn()
});

const mkStore = (group?: { id: string; label: string }): GroupStore => ({
  get: jest.fn((id: string) => (id === group?.id ? group : undefined))
} as unknown as GroupStore);

const mkState = (activeId?: string, sources: Record<string, 'vsix' | 'marketplace'> = {}): WorkspaceStateService => ({
  getActiveGroupId: jest.fn(() => activeId),
  getInstallSources: jest.fn(() => sources)
} as unknown as WorkspaceStateService);

const mkSettings = (overrides: Partial<Record<keyof SettingsService, unknown>> = {}): SettingsService => ({
  getStatusBarShowGroup: jest.fn(() => true),
  getStatusBarShowVsix: jest.fn(() => true),
  getVsixDirectory: jest.fn(() => ''),
  ...overrides
} as unknown as SettingsService);

const mkInstaller = (sources: Record<string, 'vsix' | 'marketplace'> = {}): VsixInstaller => ({
  currentSources: jest.fn(() => sources)
} as unknown as VsixInstaller);

describe('GroupStatusBarItem', () => {
  let fake: FakeItem;
  beforeEach(() => {
    fake = newFakeItem();
    (vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(fake);
  });

  it('shows "None" when no group is active', () => {
    new GroupStatusBarItem(mkStore(), mkState(), mkSettings());
    expect(fake.text).toBe('$(layers) None');
    expect(fake.show).toHaveBeenCalled();
  });

  it('shows the active group label', () => {
    new GroupStatusBarItem(mkStore({ id: 'apex', label: 'Apex' }), mkState('apex'), mkSettings());
    expect(fake.text).toBe('$(layers) Apex');
    expect(fake.tooltip).toContain('Apex');
  });

  it('hides when statusBar.showGroup is false', () => {
    new GroupStatusBarItem(
      mkStore(),
      mkState(),
      mkSettings({ getStatusBarShowGroup: jest.fn(() => false) })
    );
    expect(fake.hide).toHaveBeenCalled();
  });
});

describe('VsixStatusBarItem', () => {
  let fake: FakeItem;
  beforeEach(() => {
    fake = newFakeItem();
    (vscode.window.createStatusBarItem as jest.Mock).mockReturnValue(fake);
  });

  it('hides when no vsix directory is configured', () => {
    new VsixStatusBarItem(mkSettings(), mkInstaller());
    expect(fake.hide).toHaveBeenCalled();
  });

  it('hides when statusBar.showVsix is false even if a directory is set', () => {
    new VsixStatusBarItem(
      mkSettings({
        getVsixDirectory: jest.fn(() => '/some/dir'),
        getStatusBarShowVsix: jest.fn(() => false)
      }),
      mkInstaller()
    );
    expect(fake.hide).toHaveBeenCalled();
  });

  it('shows count with warning background when vsix sources exist', () => {
    new VsixStatusBarItem(
      mkSettings({ getVsixDirectory: jest.fn(() => '/some/dir') }),
      mkInstaller({ 'foo.a': 'vsix', 'foo.b': 'vsix', 'foo.c': 'marketplace' })
    );
    expect(fake.text).toBe('$(package) VSIX: 2');
    expect(fake.backgroundColor).toBeDefined();
    expect(fake.show).toHaveBeenCalled();
  });

  it('shows with no warning background when directory is set but no vsix sources exist', () => {
    new VsixStatusBarItem(
      mkSettings({ getVsixDirectory: jest.fn(() => '/some/dir') }),
      mkInstaller()
    );
    expect(fake.text).toBe('$(package) VSIX: 0');
    expect(fake.backgroundColor).toBeUndefined();
  });
});
