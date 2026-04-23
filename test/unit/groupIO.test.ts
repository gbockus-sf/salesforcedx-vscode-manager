import {
  applyImport,
  buildExport,
  parseImport,
  type ImportConflictStrategy
} from '../../src/groups/groupIO';
import type { SettingsService } from '../../src/services/settingsService';

const mkSettings = (initial: Record<string, unknown> = {}): SettingsService => {
  const state: Record<string, unknown> = { ...initial };
  return {
    getGroupsRaw: jest.fn(() => state),
    getGroupsByScope: jest.fn(() => ({ user: state, workspace: {} })),
    updateGroupsRaw: jest.fn(async (next: Record<string, unknown>) => {
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, next);
    })
  } as unknown as SettingsService;
};

describe('buildExport', () => {
  it('excludes built-in group ids by default', () => {
    const settings = mkSettings({
      apex: { label: 'Apex override', extensions: ['salesforce.core'] },
      custom: { label: 'Custom', extensions: ['redhat.vscode-xml'] }
    });
    const payload = buildExport(settings);
    expect(payload.version).toBe(1);
    expect(payload.groups.map(g => g.id)).toEqual(['custom']);
  });

  it('includes built-ins when asked', () => {
    const settings = mkSettings({
      apex: { label: 'Apex', extensions: ['salesforce.core'] },
      custom: { label: 'Custom', extensions: [] }
    });
    const payload = buildExport(settings, { includeBuiltIns: true });
    expect(payload.groups.map(g => g.id).sort()).toEqual(['apex', 'custom']);
  });

  it('normalizes malformed settings entries (drops bad fields)', () => {
    const settings = mkSettings({
      custom: {
        label: 'Custom',
        extensions: ['a.b', 123, 'c.d'],
        applyScope: 'bogus'
      }
    });
    const payload = buildExport(settings);
    expect(payload.groups[0].extensions).toEqual(['a.b', 'c.d']);
    expect(payload.groups[0].applyScope).toBeUndefined();
  });
});

describe('parseImport', () => {
  it('accepts a well-formed export', () => {
    const raw = JSON.stringify({
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      groups: [
        { id: 'my', label: 'My', extensions: ['a.b'] }
      ]
    });
    expect(parseImport(raw)).toEqual([
      { id: 'my', label: 'My', description: undefined, extensions: ['a.b'], applyScope: undefined }
    ]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseImport('{not json')).toThrow(/not valid JSON/);
  });

  it('throws on unsupported version', () => {
    expect(() => parseImport(JSON.stringify({ version: 99, groups: [] }))).toThrow(
      /unsupported export version/
    );
  });

  it('throws when `groups` is missing', () => {
    expect(() => parseImport(JSON.stringify({ version: 1 }))).toThrow(/missing `groups`/);
  });

  it('silently skips malformed individual group entries', () => {
    const raw = JSON.stringify({
      version: 1,
      groups: [
        { id: 'ok', label: 'OK', extensions: ['a.b'] },
        'not-an-object',
        { id: 'no-label', extensions: [] },
        { label: 'no-id', extensions: [] }
      ]
    });
    expect(parseImport(raw).map(g => g.id)).toEqual(['ok']);
  });
});

describe('applyImport', () => {
  const resolveAlways = (answer: ImportConflictStrategy) =>
    jest.fn(async () => answer);

  it('writes every valid import when there are no conflicts', async () => {
    const settings = mkSettings();
    const r = await applyImport(
      [
        { id: 'a', label: 'A', extensions: ['x.y'] },
        { id: 'b', label: 'B', extensions: ['x.z'] }
      ],
      settings,
      resolveAlways('overwrite')
    );
    expect(r.imported).toEqual(['a', 'b']);
    expect(r.skipped).toEqual([]);
    expect(settings.getGroupsRaw()).toHaveProperty('a');
    expect(settings.getGroupsRaw()).toHaveProperty('b');
  });

  it('honors per-conflict strategy from the resolver', async () => {
    const settings = mkSettings({ existing: { label: 'Old', extensions: ['old.one'] } });
    const r = await applyImport(
      [{ id: 'existing', label: 'New', extensions: ['new.one'] }],
      settings,
      resolveAlways('overwrite')
    );
    expect(r.imported).toEqual(['existing']);
    expect((settings.getGroupsRaw() as Record<string, { label: string }>).existing.label).toBe(
      'New'
    );
  });

  it('skip strategy leaves the existing entry untouched', async () => {
    const settings = mkSettings({ existing: { label: 'Old', extensions: ['old.one'] } });
    const r = await applyImport(
      [{ id: 'existing', label: 'New', extensions: ['new.one'] }],
      settings,
      resolveAlways('skip')
    );
    expect(r.imported).toEqual([]);
    expect(r.skipped).toEqual([{ id: 'existing', reason: 'conflict' }]);
    expect((settings.getGroupsRaw() as Record<string, { label: string }>).existing.label).toBe(
      'Old'
    );
  });

  it('skip-all on the first conflict applies to every subsequent conflict', async () => {
    const settings = mkSettings({
      a: { label: 'A-old', extensions: ['x.y'] },
      b: { label: 'B-old', extensions: ['x.z'] }
    });
    const resolver = jest.fn(async () => 'skip-all' as const);
    const r = await applyImport(
      [
        { id: 'a', label: 'A-new', extensions: ['x.y'] },
        { id: 'b', label: 'B-new', extensions: ['x.z'] }
      ],
      settings,
      resolver
    );
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(r.skipped.map(s => s.id)).toEqual(['a', 'b']);
  });

  it('rejects empty-extensions imports (runs through validateGroup)', async () => {
    const settings = mkSettings();
    const r = await applyImport(
      [{ id: 'empty', label: 'Empty', extensions: [] }],
      settings,
      resolveAlways('overwrite')
    );
    expect(r.imported).toEqual([]);
    expect(r.skipped).toEqual([{ id: 'empty', reason: expect.stringMatching(/empty/i) }]);
  });
});
