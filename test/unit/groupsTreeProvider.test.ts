import { GroupsTreeProvider } from '../../src/views/groupsTreeProvider';
import { GroupStore } from '../../src/groups/groupStore';
import type { ExtensionService, NodeVersionInfo } from '../../src/services/extensionService';
import type { WorkspaceStateService } from '../../src/services/workspaceStateService';
import type { SettingsService } from '../../src/services/settingsService';

const mkSettings = (): SettingsService => ({
  getGroupsRaw: jest.fn(() => ({})),
  getGroupsByScope: jest.fn(() => ({ user: {}, workspace: {} })),
  updateGroupsRaw: jest.fn()
} as unknown as SettingsService);

interface ExtStub {
  installed: Set<string>;
  versions: Map<string, string>;
  nodeInfo: Map<string, NodeVersionInfo>;
}

interface Manifest { extensionDependencies?: string[]; extensionPack?: string[] }

const mkExt = (
  stub: Partial<ExtStub> & { manifests?: Map<string, Manifest> } = {}
): ExtensionService => {
  const installed = stub.installed ?? new Set<string>();
  const versions = stub.versions ?? new Map<string, string>();
  const nodeInfo = stub.nodeInfo ?? new Map<string, NodeVersionInfo>();
  const manifests = stub.manifests ?? new Map<string, Manifest>();
  return {
    isInstalled: jest.fn((id: string) => installed.has(id)),
    isEnabled: jest.fn((id: string) => installed.has(id)),
    getInstalledVersion: jest.fn((id: string) => versions.get(id)),
    readManifest: jest.fn((id: string) => manifests.get(id)),
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
    expect(roots.map(r => r.group.id)).toEqual([
      'apex',
      'lightning',
      'react',
      'salesforce-extension-pack',
      'salesforce-extension-pack-expanded'
    ]);
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
    // contextValue now carries install-state flags (installed / notInstalled)
    // so view/item/context menus can gate Install vs. Uninstall inline
    // buttons. A freshly-installed extension without updates should read
    // as exactly 'extension:installed'.
    expect(extItem.contextValue).toBe('extension:installed');
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

  it('extension node becomes collapsible when it has extensionDependencies or extensionPack', () => {
    const manifests = new Map([
      ['salesforce.salesforcedx-vscode-apex', { extensionDependencies: ['salesforce.salesforcedx-vscode-core'] }]
    ]);
    const installed = new Set(['salesforce.salesforcedx-vscode-apex']);
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), mkExt({ installed, manifests }), mkState());
    const item = tree.getTreeItem({
      kind: 'extension',
      extensionId: 'salesforce.salesforcedx-vscode-apex',
      groupId: 'apex',
      installed: true,
      enabled: true,
      source: 'marketplace',
      updateAvailable: false
    });
    // 1 = Collapsed
    expect(item.collapsibleState).toBe(1);
  });

  it('expands an extension node into its extensionDependencies with link icons', () => {
    const manifests = new Map([
      ['salesforce.apex', { extensionDependencies: ['salesforce.core', 'salesforce.services'] }]
    ]);
    const installed = new Set(['salesforce.apex', 'salesforce.core']);
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), mkExt({ installed, manifests }), mkState());
    const children = tree.getChildren({
      kind: 'extension',
      extensionId: 'salesforce.apex',
      groupId: 'apex',
      installed: true,
      enabled: true,
      source: 'marketplace',
      updateAvailable: false
    }) as Array<{ kind: 'dep-child'; relation: 'dep' | 'pack'; extensionId: string; installed: boolean }>;
    expect(children.map(c => c.extensionId)).toEqual(['salesforce.core', 'salesforce.services']);
    expect(children.every(c => c.relation === 'dep')).toBe(true);
    expect(children[0].installed).toBe(true);
    expect(children[1].installed).toBe(false);
  });

  it('expands an extension node into its extensionPack members with pack icons', () => {
    const manifests = new Map([
      ['salesforce.expanded', { extensionPack: ['salesforce.apex', 'salesforce.lwc'] }]
    ]);
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), mkExt({ manifests }), mkState());
    const children = tree.getChildren({
      kind: 'extension',
      extensionId: 'salesforce.expanded',
      groupId: 'x',
      installed: true,
      enabled: true,
      source: 'marketplace',
      updateAvailable: false
    }) as Array<{ kind: 'dep-child'; relation: 'dep' | 'pack' }>;
    expect(children.map(c => c.relation)).toEqual(['pack', 'pack']);
  });

  it('dep-child tree items use the link icon for deps and package icon for pack members', () => {
    const tree = new GroupsTreeProvider(new GroupStore(mkSettings()), mkExt(), mkState());
    const depItem = tree.getTreeItem({
      kind: 'dep-child',
      relation: 'dep',
      parentExtensionId: 'salesforce.apex',
      extensionId: 'salesforce.core',
      installed: true,
      enabled: true
    });
    expect((depItem.iconPath as { id: string }).id).toBe('link');
    expect(depItem.contextValue).toBe('extension:child:dep');

    const packItem = tree.getTreeItem({
      kind: 'dep-child',
      relation: 'pack',
      parentExtensionId: 'salesforce.expanded',
      extensionId: 'salesforce.apex',
      installed: true,
      enabled: true
    });
    expect((packItem.iconPath as { id: string }).id).toBe('package');
    expect(packItem.contextValue).toBe('extension:child:pack');
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
