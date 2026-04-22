import { GroupStore } from '../../src/groups/groupStore';
import { BUILT_IN_GROUPS } from '../../src/groups/builtInGroups';
import type { SettingsService } from '../../src/services/settingsService';

const mkSettings = (initial: Record<string, unknown> = {}): SettingsService => {
  const state: Record<string, unknown> = { ...initial };
  return {
    getGroupsRaw: jest.fn(() => state),
    updateGroupsRaw: jest.fn(async (next: Record<string, unknown>) => {
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, next);
    })
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
