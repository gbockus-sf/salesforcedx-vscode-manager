import { GroupsTreeProvider } from '../../src/views/groupsTreeProvider';
import { GroupStore } from '../../src/groups/groupStore';
import type { ExtensionService } from '../../src/services/extensionService';
import type { WorkspaceStateService } from '../../src/services/workspaceStateService';
import type { SettingsService } from '../../src/services/settingsService';

const mkSettings = (): SettingsService => ({
  getGroupsRaw: jest.fn(() => ({})),
  updateGroupsRaw: jest.fn()
} as unknown as SettingsService);

const mkExt = (installed: Set<string> = new Set()): ExtensionService => ({
  isInstalled: jest.fn((id: string) => installed.has(id)),
  isEnabled: jest.fn((id: string) => installed.has(id))
} as unknown as ExtensionService);

const mkState = (activeId?: string, sources: Record<string, 'vsix' | 'marketplace'> = {}): WorkspaceStateService => ({
  getActiveGroupId: jest.fn(() => activeId),
  getInstallSources: jest.fn(() => sources)
} as unknown as WorkspaceStateService);

describe('GroupsTreeProvider', () => {
  it('root children are the built-in groups', () => {
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), mkExt(), mkState());
    const roots = tree.getChildren() as Array<{ kind: 'group'; group: { id: string } }>;
    expect(roots.map(r => r.group.id)).toEqual(['apex', 'lightning', 'react']);
    expect(roots.every(r => r.kind === 'group')).toBe(true);
  });

  it('marks the active group as active', () => {
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), mkExt(), mkState('apex'));
    const roots = tree.getChildren() as Array<{ group: { id: string }; isActive: boolean }>;
    expect(roots.find(r => r.group.id === 'apex')!.isActive).toBe(true);
    expect(roots.find(r => r.group.id === 'lightning')!.isActive).toBe(false);
  });

  it('expands a group into its member extensions with installed/enabled state', () => {
    const installed = new Set(['salesforce.salesforcedx-vscode-apex']);
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), mkExt(installed), mkState(undefined, {
      'salesforce.salesforcedx-vscode-apex': 'vsix'
    }));
    const roots = tree.getChildren();
    const apex = roots.find(r => r.kind === 'group' && r.group.id === 'apex')!;
    const children = tree.getChildren(apex) as Array<{ extensionId: string; installed: boolean; source: string }>;
    expect(children.length).toBeGreaterThan(0);
    const apexExt = children.find(c => c.extensionId === 'salesforce.salesforcedx-vscode-apex')!;
    expect(apexExt.installed).toBe(true);
    expect(apexExt.source).toBe('vsix');
    const missing = children.find(c => c.extensionId === 'salesforce.salesforcedx-vscode-core')!;
    expect(missing.installed).toBe(false);
  });

  it('getTreeItem returns a visible label for group and extension nodes', () => {
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), mkExt(), mkState());
    const roots = tree.getChildren();
    const groupItem = tree.getTreeItem(roots[0]);
    expect(typeof groupItem.label).toBe('string');
    expect(groupItem.contextValue).toMatch(/^group:/);
    const extItem = tree.getTreeItem({
      kind: 'extension',
      extensionId: 'salesforce.salesforcedx-vscode-apex',
      groupId: 'apex',
      installed: true,
      enabled: true,
      source: 'marketplace'
    });
    expect(extItem.label).toBe('salesforcedx-vscode-apex');
    expect(extItem.contextValue).toBe('extension');
  });
});
