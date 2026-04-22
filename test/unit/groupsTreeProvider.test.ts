import { GroupsTreeProvider } from '../../src/views/groupsTreeProvider';
import { GroupStore } from '../../src/groups/groupStore';
import type { ExtensionService, NodeVersionInfo } from '../../src/services/extensionService';
import type { WorkspaceStateService } from '../../src/services/workspaceStateService';
import type { SettingsService } from '../../src/services/settingsService';

const mkSettings = (): SettingsService => ({
  getGroupsRaw: jest.fn(() => ({})),
  updateGroupsRaw: jest.fn()
} as unknown as SettingsService);

interface ExtStub {
  installed: Set<string>;
  versions: Map<string, string>;
  nodeInfo: Map<string, NodeVersionInfo>;
}

const mkExt = (stub: Partial<ExtStub> = {}): ExtensionService => {
  const installed = stub.installed ?? new Set<string>();
  const versions = stub.versions ?? new Map<string, string>();
  const nodeInfo = stub.nodeInfo ?? new Map<string, NodeVersionInfo>();
  return {
    isInstalled: jest.fn((id: string) => installed.has(id)),
    isEnabled: jest.fn((id: string) => installed.has(id)),
    getInstalledVersion: jest.fn((id: string) => versions.get(id)),
    refreshInstalledCliVersions: jest.fn(async () => undefined),
    getNodeVersionInfo: jest.fn(async (id: string) =>
      nodeInfo.get(id) ?? {
        installedVersion: versions.get(id),
        latestVersion: undefined,
        updateAvailable: false,
        source: 'unknown' as const
      }
    ),
    clearCliVersionCache: jest.fn()
  } as unknown as ExtensionService;
};

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
    const tree = new GroupsTreeProvider(
      new GroupStore(mkSettings()),
      mkExt({ installed }),
      mkState(undefined, {
        'salesforce.salesforcedx-vscode-apex': 'vsix'
      })
    );
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
      source: 'marketplace',
      updateAvailable: false
    });
    expect(extItem.label).toBe('salesforcedx-vscode-apex');
    expect(extItem.contextValue).toBe('extension');
  });

  it('shows the installed version in the description', () => {
    const versions = new Map([['salesforce.salesforcedx-vscode-apex', '63.1.0']]);
    const installed = new Set(['salesforce.salesforcedx-vscode-apex']);
    const tree = new GroupsTreeProvider(
      new GroupStore(mkSettings()),
      mkExt({ installed, versions }),
      mkState()
    );
    const extItem = tree.getTreeItem({
      kind: 'extension',
      extensionId: 'salesforce.salesforcedx-vscode-apex',
      groupId: 'apex',
      installed: true,
      enabled: true,
      source: 'marketplace',
      installedVersion: '63.1.0',
      updateAvailable: false
    });
    expect(String(extItem.description)).toContain('v63.1.0');
  });

  it('renders "not installed" in the description when the extension is missing', () => {
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), mkExt(), mkState());
    const extItem = tree.getTreeItem({
      kind: 'extension',
      extensionId: 'salesforce.salesforcedx-vscode-apex',
      groupId: 'apex',
      installed: false,
      enabled: false,
      source: 'unknown',
      updateAvailable: false
    });
    expect(extItem.description).toBe('not installed');
  });

  it('uses an arrow-circle-up icon and contextValue when an update is available', () => {
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), mkExt(), mkState());
    const extItem = tree.getTreeItem({
      kind: 'extension',
      extensionId: 'salesforce.salesforcedx-vscode-apex',
      groupId: 'apex',
      installed: true,
      enabled: true,
      source: 'marketplace',
      installedVersion: '63.0.0',
      latestVersion: '63.1.0',
      updateAvailable: true
    });
    const icon = extItem.iconPath as { id: string };
    expect(icon.id).toBe('arrow-circle-up');
    expect(extItem.contextValue).toContain('updateAvailable');
    expect(String(extItem.description)).toContain('update → v63.1.0');
  });

  it('sets the package icon and VSIX walkthrough tooltip when the extension is sourced from VSIX', () => {
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), mkExt(), mkState());
    const extItem = tree.getTreeItem({
      kind: 'extension',
      extensionId: 'salesforce.salesforcedx-vscode-apex',
      groupId: 'apex',
      installed: true,
      enabled: true,
      source: 'vsix',
      vsixFilename: 'salesforce.salesforcedx-vscode-apex-63.0.0.vsix',
      installedVersion: '63.0.0',
      updateAvailable: false
    });
    const icon = extItem.iconPath as { id: string };
    expect(icon.id).toBe('package');
    expect(extItem.contextValue).toContain('vsix');
    expect(String(extItem.tooltip)).toContain('resources/walkthrough/vsix.md');
  });

  it('refreshVersionInfo populates version info for every group member', async () => {
    const installed = new Set(['salesforce.salesforcedx-vscode-apex']);
    const nodeInfo = new Map<string, NodeVersionInfo>([
      [
        'salesforce.salesforcedx-vscode-apex',
        {
          installedVersion: '63.0.0',
          latestVersion: '63.1.0',
          updateAvailable: true,
          source: 'marketplace'
        }
      ]
    ]);
    const ext = mkExt({ installed, nodeInfo });
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), ext, mkState());
    await tree.refreshVersionInfo();
    const info = tree.getVersionInfo('salesforce.salesforcedx-vscode-apex');
    expect(info?.updateAvailable).toBe(true);
    expect(info?.latestVersion).toBe('63.1.0');
    expect(ext.refreshInstalledCliVersions).toHaveBeenCalled();
  });
});
