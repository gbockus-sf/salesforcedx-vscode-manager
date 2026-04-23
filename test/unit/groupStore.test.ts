import * as vscode from 'vscode';
import { GroupStore } from '../../src/groups/groupStore';
import { BUILT_IN_GROUPS } from '../../src/groups/builtInGroups';
import type { SettingsService } from '../../src/services/settingsService';

interface Layers {
  user: Record<string, unknown>;
  workspace: Record<string, unknown>;
}

const mkSettings = (
  initial: Record<string, unknown> | Partial<Layers> = {}
): SettingsService => {
  // Accept either a legacy shape ({ id: { ... }, ... } — goes into user layer)
  // or a layers shape ({ user, workspace }).
  const isLayers = 'user' in initial || 'workspace' in initial;
  const state: Layers = isLayers
    ? {
        user: { ...((initial as Partial<Layers>).user ?? {}) },
        workspace: { ...((initial as Partial<Layers>).workspace ?? {}) }
      }
    : { user: { ...(initial as Record<string, unknown>) }, workspace: {} };

  const merged = (): Record<string, unknown> => ({ ...state.user, ...state.workspace });

  return {
    getGroupsRaw: jest.fn(() => merged()),
    getGroupsByScope: jest.fn(() => ({ user: state.user, workspace: state.workspace })),
    updateGroupsRaw: jest.fn(
      async (next: Record<string, unknown>, target?: vscode.ConfigurationTarget) => {
        const layer: keyof Layers =
          target === vscode.ConfigurationTarget.Workspace ? 'workspace' : 'user';
        state[layer] = { ...next };
      }
    )
  } as unknown as SettingsService;
};

describe('GroupStore', () => {
  it('list() returns all built-ins when user setting is empty', () => {
    const store = new GroupStore(mkSettings());
    const ids = store.list().map(g => g.id);
    expect(ids).toEqual(BUILT_IN_GROUPS.map(g => g.id));
  });

  it('list() treats matching user entries as overrides but keeps builtIn marker', () => {
    const store = new GroupStore(
      mkSettings({
        apex: { label: 'My Apex', extensions: ['foo.bar'] }
      })
    );
    const apex = store.list().find(g => g.id === 'apex')!;
    expect(apex.label).toBe('My Apex');
    expect(apex.extensions).toEqual(['foo.bar']);
    expect(apex.builtIn).toBe(true);
  });

  it('list() appends user-only groups with builtIn=false', () => {
    const store = new GroupStore(
      mkSettings({
        custom: { label: 'Custom', extensions: ['a.b'] }
      })
    );
    const custom = store.list().find(g => g.id === 'custom')!;
    expect(custom.builtIn).toBe(false);
  });

  it('list() drops malformed user entries', () => {
    const store = new GroupStore(
      mkSettings({
        broken: { extensions: 'not-an-array' },
        good: { label: 'G', extensions: [] }
      })
    );
    const ids = store.list().map(g => g.id);
    expect(ids).toContain('good');
    expect(ids).not.toContain('broken');
  });

  it('upsert() persists a group to the settings store', async () => {
    const settings = mkSettings();
    const store = new GroupStore(settings);
    await store.upsert({ id: 'my', label: 'My', extensions: ['a.b'] });
    expect(settings.updateGroupsRaw).toHaveBeenCalled();
    expect(store.get('my')?.extensions).toEqual(['a.b']);
  });

  it('upsert() rejects an empty user group with a helpful message', async () => {
    const store = new GroupStore(mkSettings());
    await expect(store.upsert({ id: 'empty', label: 'Empty', extensions: [] })).rejects.toThrow(
      /empty/i
    );
  });

  it('upsert() allows an empty override for a built-in group', async () => {
    const settings = mkSettings();
    const store = new GroupStore(settings);
    await store.upsert({ id: 'apex', label: 'Apex', extensions: [], builtIn: true });
    expect(settings.updateGroupsRaw).toHaveBeenCalled();
  });

  it('upsert() rejects a malformed id', async () => {
    const store = new GroupStore(mkSettings());
    await expect(store.upsert({ id: '9bad', label: 'x', extensions: ['a.b'] })).rejects.toThrow(
      /id/i
    );
  });

  describe('scope', () => {
    it('workspace entries override user entries at the same id', () => {
      const store = new GroupStore(
        mkSettings({
          user: { custom: { label: 'User', extensions: ['u.ext'] } },
          workspace: { custom: { label: 'Workspace', extensions: ['ws.ext'] } }
        })
      );
      expect(store.get('custom')!.label).toBe('Workspace');
    });

    it('getScope() reports the correct layer per id', () => {
      const store = new GroupStore(
        mkSettings({
          user: { onlyUser: { label: 'U', extensions: ['a.b'] } },
          workspace: { onlyWs: { label: 'W', extensions: ['a.b'] } }
        })
      );
      expect(store.getScope('onlyUser')).toBe('user');
      expect(store.getScope('onlyWs')).toBe('workspace');
      expect(store.getScope('apex')).toBe('builtIn'); // built-in with no override
    });

    it('upsert() with target=workspace lands only in the workspace layer', async () => {
      const settings = mkSettings();
      const store = new GroupStore(settings);
      await store.upsert({ id: 'ws', label: 'W', extensions: ['a.b'] }, 'workspace');
      expect(store.getScope('ws')).toBe('workspace');
    });

    it('moveToScope() migrates a group between layers and deletes the old entry', async () => {
      const settings = mkSettings({
        user: { travel: { label: 'T', extensions: ['a.b'] } }
      });
      const store = new GroupStore(settings);
      await store.moveToScope('travel', 'workspace');
      expect(store.getScope('travel')).toBe('workspace');
      // User-layer entry should be gone now.
      expect(settings.getGroupsByScope().user).not.toHaveProperty('travel');
    });

    it('remove() clears both layers for the same id', async () => {
      const settings = mkSettings({
        user: { ghost: { label: 'G', extensions: ['a.b'] } },
        workspace: { ghost: { label: 'G', extensions: ['a.b'] } }
      });
      const store = new GroupStore(settings);
      await store.remove('ghost');
      expect(settings.getGroupsByScope()).toEqual({ user: {}, workspace: {} });
    });
  });

  describe('pack groups', () => {
    beforeEach(() => {
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
        {
          id: 'salesforce.salesforcedx-vscode',
          packageJSON: {
            displayName: 'Salesforce Extension Pack',
            extensionPack: [
              'salesforce.salesforcedx-vscode-apex',
              'salesforce.salesforcedx-vscode-core'
            ]
          }
        } as unknown as vscode.Extension<unknown>
      ];
    });
    afterEach(() => {
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
    });

    it('list() surfaces every Salesforce-published pack with source="pack"', () => {
      const store = new GroupStore(mkSettings());
      const pack = store.list().find(g => g.id === 'pack:salesforce.salesforcedx-vscode');
      expect(pack?.source).toBe('pack');
      expect(pack?.builtIn).toBe(true);
      expect(pack?.extensions).toEqual([
        'salesforce.salesforcedx-vscode-apex',
        'salesforce.salesforcedx-vscode-core'
      ]);
    });

    it('remove() refuses to touch a pack group', async () => {
      const store = new GroupStore(mkSettings());
      await expect(store.remove('pack:salesforce.salesforcedx-vscode')).rejects.toThrow(/read-only/i);
    });

    it('moveToScope() refuses to move a pack group', async () => {
      const store = new GroupStore(mkSettings());
      await expect(
        store.moveToScope('pack:salesforce.salesforcedx-vscode', 'workspace')
      ).rejects.toThrow(/pack manifest/i);
    });
  });

  describe('publisher catalog groups', () => {
    it('list() surfaces a catalog group when the read returns entries', () => {
      const store = new GroupStore(mkSettings());
      store.setPublisherCatalog(() => ({
        publisher: 'salesforce',
        extensionIds: ['salesforce.apex', 'salesforce.core']
      }));
      const catalog = store.list().find(g => g.id === 'catalog:salesforce');
      expect(catalog?.source).toBe('catalog');
      expect(catalog?.builtIn).toBe(true);
      expect(catalog?.extensions).toEqual(['salesforce.apex', 'salesforce.core']);
      expect(catalog?.label).toMatch(/all salesforce extensions/i);
    });

    it('list() omits the catalog group when the snapshot is empty', () => {
      const store = new GroupStore(mkSettings());
      store.setPublisherCatalog(() => ({ publisher: 'salesforce', extensionIds: [] }));
      expect(store.list().some(g => g.id === 'catalog:salesforce')).toBe(false);
    });

    it('remove() refuses to touch a catalog group', async () => {
      const store = new GroupStore(mkSettings());
      store.setPublisherCatalog(() => ({
        publisher: 'salesforce',
        extensionIds: ['salesforce.apex']
      }));
      await expect(store.remove('catalog:salesforce')).rejects.toThrow(/read-only/i);
    });

    it('moveToScope() refuses to move a catalog group', async () => {
      const store = new GroupStore(mkSettings());
      store.setPublisherCatalog(() => ({
        publisher: 'salesforce',
        extensionIds: ['salesforce.apex']
      }));
      await expect(store.moveToScope('catalog:salesforce', 'workspace')).rejects.toThrow(
        /marketplace/i
      );
    });
  });

  it('remove() on a built-in clears the user override (but the group stays visible)', async () => {
    const settings = mkSettings({
      apex: { label: 'overridden', extensions: [] }
    });
    const store = new GroupStore(settings);
    await store.remove('apex');
    const apex = store.list().find(g => g.id === 'apex')!;
    expect(apex.label).toBe('Apex'); // built-in default restored
  });

  it('remove() on a user group deletes it', async () => {
    const settings = mkSettings({
      custom: { label: 'Custom', extensions: [] }
    });
    const store = new GroupStore(settings);
    await store.remove('custom');
    expect(store.get('custom')).toBeUndefined();
  });

  it('remove() on an unknown id throws', async () => {
    const store = new GroupStore(mkSettings());
    await expect(store.remove('does-not-exist')).rejects.toThrow();
  });
});
