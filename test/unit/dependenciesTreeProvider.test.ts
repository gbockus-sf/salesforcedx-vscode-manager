import {
  DependenciesTreeProvider,
  formatReport
} from '../../src/views/dependenciesTreeProvider';
import type { DependencyRegistry } from '../../src/dependencies/registry';
import type { DependencyCheck, DependencyStatus } from '../../src/dependencies/types';

const mkCheck = (overrides: Partial<DependencyCheck> = {}): DependencyCheck => ({
  id: 'x',
  label: 'x',
  category: 'cli',
  check: { type: 'exec', command: 'x' },
  ...overrides
});

const mkRegistry = (
  checks: DependencyCheck[],
  statuses: Record<string, DependencyStatus> = {}
): DependencyRegistry => ({
  collect: jest.fn(async () => checks),
  runOne: jest.fn(async (id: string) => statuses[id] ?? { state: 'unknown' }),
  runAll: jest.fn(async () => new Map(Object.entries(statuses))),
  clearCache: jest.fn(),
  setIsInstalledLookup: jest.fn()
} as unknown as DependencyRegistry);

describe('DependenciesTreeProvider', () => {
  it('groups checks by category at the root', async () => {
    const registry = mkRegistry([
      mkCheck({ id: 'a', category: 'cli' }),
      mkCheck({ id: 'b', category: 'runtime' }),
      mkCheck({ id: 'c', category: 'per-extension' })
    ]);
    const tree = new DependenciesTreeProvider(registry);
    const roots = (await tree.getChildren()) as { kind: 'category'; category: string }[];
    expect(roots.map(r => r.category)).toEqual(['cli', 'runtime', 'per-extension']);
  });

  it('skips empty categories', async () => {
    const registry = mkRegistry([mkCheck({ id: 'a', category: 'cli' })]);
    const tree = new DependenciesTreeProvider(registry);
    const roots = (await tree.getChildren()) as { kind: 'category'; category: string }[];
    expect(roots.map(r => r.category)).toEqual(['cli']);
  });

  it('expands category to its checks with unknown status before a run', async () => {
    const checks = [mkCheck({ id: 'a' }), mkCheck({ id: 'b' })];
    const tree = new DependenciesTreeProvider(mkRegistry(checks));
    const roots = await tree.getChildren();
    const cli = roots[0];
    const children = (await tree.getChildren(cli)) as Array<{ kind: 'check'; status: DependencyStatus }>;
    expect(children.length).toBe(2);
    expect(children.every(c => c.status.state === 'unknown')).toBe(true);
  });

  it('runChecks() populates statuses and refreshes', async () => {
    const checks = [mkCheck({ id: 'a' })];
    const registry = mkRegistry(checks, { a: { state: 'ok', version: '1.0.0' } });
    const tree = new DependenciesTreeProvider(registry);
    await tree.runChecks();
    expect(tree.getStatuses().get('a')?.state).toBe('ok');
  });

  it('runOne() updates just the one status', async () => {
    const checks = [mkCheck({ id: 'a' }), mkCheck({ id: 'b' })];
    const registry = mkRegistry(checks, { a: { state: 'fail', detail: 'missing' } });
    const tree = new DependenciesTreeProvider(registry);
    await tree.runOne('a');
    expect(tree.getStatuses().get('a')?.state).toBe('fail');
    expect(tree.getStatuses().get('b')).toBeUndefined();
  });

  it('getTreeItem reflects status icon + context value', async () => {
    const tree = new DependenciesTreeProvider(mkRegistry([]));
    const item = tree.getTreeItem({
      kind: 'check',
      check: mkCheck({ id: 'a', remediationUrl: 'https://example.test' }),
      status: { state: 'fail', detail: 'nope' }
    });
    expect(item.contextValue).toBe('check:withRemediationUrl');
    expect(item.description).toBe('nope');
  });

  it('getTreeItem tooltip lists a single owner when only ownerExtensionId is set', async () => {
    const tree = new DependenciesTreeProvider(mkRegistry([]));
    const item = tree.getTreeItem({
      kind: 'check',
      check: mkCheck({ id: 'a', ownerExtensionId: 'salesforce.apex' }),
      status: { state: 'ok', version: '1.0.0' }
    });
    expect(String(item.tooltip)).toContain('Required by: salesforce.apex');
  });

  it('getTreeItem tooltip lists multiple owners when ownerExtensionIds has more than one entry', async () => {
    const tree = new DependenciesTreeProvider(mkRegistry([]));
    const item = tree.getTreeItem({
      kind: 'check',
      check: mkCheck({
        id: 'java',
        label: 'Java JDK 11+',
        ownerExtensionId: 'salesforce.apex',
        ownerExtensionIds: ['salesforce.apex', 'salesforce.soql', 'salesforce.visualforce']
      }),
      status: { state: 'ok', version: '17.0.1' }
    });
    expect(String(item.tooltip)).toContain(
      'Required by: salesforce.apex, salesforce.soql, salesforce.visualforce'
    );
  });

  describe('Salesforce CLI update badge', () => {
    it('appends an update badge + tooltip when the latest version is newer', () => {
      // Regression for the "there's no visible signal my CLI is
      // stale" report. The passing Salesforce CLI row must make the
      // upgrade opportunity obvious.
      const tree = new DependenciesTreeProvider(mkRegistry([]));
      tree.setCliLatestVersion('2.46.1');
      const item = tree.getTreeItem({
        kind: 'check',
        check: mkCheck({ id: 'builtin.sf-cli', label: 'Salesforce CLI (sf)' }),
        status: { state: 'ok', version: '2.45.0' }
      });
      expect(String(item.description)).toContain('update → v2.46.1');
      expect(String(item.tooltip)).toContain('sf update');
      const icon = item.iconPath as { id: string };
      expect(icon.id).toBe('arrow-circle-up');
    });

    it('leaves the row unchanged when installed and latest match', () => {
      const tree = new DependenciesTreeProvider(mkRegistry([]));
      tree.setCliLatestVersion('2.46.1');
      const item = tree.getTreeItem({
        kind: 'check',
        check: mkCheck({ id: 'builtin.sf-cli', label: 'Salesforce CLI (sf)' }),
        status: { state: 'ok', version: '2.46.1' }
      });
      expect(String(item.description)).not.toContain('update →');
      const icon = item.iconPath as { id: string };
      expect(icon.id).not.toBe('arrow-circle-up');
    });

    it('suppresses the badge when the CLI check itself is failing', () => {
      // A broken `sf --version` call shouldn't pretend everything's
      // fine; the red error icon stays red and we don't distract
      // with an update hint.
      const tree = new DependenciesTreeProvider(mkRegistry([]));
      tree.setCliLatestVersion('2.46.1');
      const item = tree.getTreeItem({
        kind: 'check',
        check: mkCheck({ id: 'builtin.sf-cli', label: 'Salesforce CLI (sf)' }),
        status: { state: 'fail', detail: 'sf not found' }
      });
      const icon = item.iconPath as { id: string };
      expect(icon.id).toBe('error');
    });

    it('does not affect other check rows that happen to have a version', () => {
      // Node / Java shouldn't accidentally render the CLI badge if
      // someone mistakes `builtin.sf-cli` for a category match.
      const tree = new DependenciesTreeProvider(mkRegistry([]));
      tree.setCliLatestVersion('2.46.1');
      const item = tree.getTreeItem({
        kind: 'check',
        check: mkCheck({ id: 'builtin.node', label: 'Node.js' }),
        status: { state: 'ok', version: '18.0.0' }
      });
      expect(String(item.description)).not.toContain('update →');
    });

    it('appends :sfCliUpdate to the contextValue so menus can gate Upgrade action', () => {
      // The inline "Upgrade" button in package.json matches `:sfCliUpdate`
      // and is invisible until the update is actually pending.
      const tree = new DependenciesTreeProvider(mkRegistry([]));
      tree.setCliLatestVersion('2.46.1');
      const item = tree.getTreeItem({
        kind: 'check',
        check: mkCheck({
          id: 'builtin.sf-cli',
          label: 'Salesforce CLI (sf)',
          remediationUrl: 'https://developer.salesforce.com/tools/salesforcecli'
        }),
        status: { state: 'ok', version: '2.45.0' }
      });
      expect(item.contextValue).toContain(':sfCliUpdate');
    });

    it('getCliUpdateInfo returns installed + latest versions when an upgrade is pending', async () => {
      // The status bar reads from this getter rather than re-deriving
      // the comparison; keeping a single source of truth.
      const checks = [mkCheck({ id: 'builtin.sf-cli', label: 'Salesforce CLI (sf)' })];
      const tree = new DependenciesTreeProvider(
        mkRegistry(checks, { 'builtin.sf-cli': { state: 'ok', version: '2.45.0' } })
      );
      await tree.runChecks();
      tree.setCliLatestVersion('2.46.1');
      expect(tree.getCliUpdateInfo()).toEqual({ installed: '2.45.0', latest: '2.46.1' });
    });

    it('getCliUpdateInfo returns undefined when versions are at parity', async () => {
      const checks = [mkCheck({ id: 'builtin.sf-cli', label: 'Salesforce CLI (sf)' })];
      const tree = new DependenciesTreeProvider(
        mkRegistry(checks, { 'builtin.sf-cli': { state: 'ok', version: '2.46.1' } })
      );
      await tree.runChecks();
      tree.setCliLatestVersion('2.46.1');
      expect(tree.getCliUpdateInfo()).toBeUndefined();
    });

    it('getCliUpdateInfo returns undefined when the check is failing', async () => {
      const checks = [mkCheck({ id: 'builtin.sf-cli', label: 'Salesforce CLI (sf)' })];
      const tree = new DependenciesTreeProvider(
        mkRegistry(checks, { 'builtin.sf-cli': { state: 'fail', detail: 'sf not found' } })
      );
      await tree.runChecks();
      tree.setCliLatestVersion('2.46.1');
      expect(tree.getCliUpdateInfo()).toBeUndefined();
    });
  });
});

describe('formatReport', () => {
  it('renders a markdown report with per-category sections and remediation', () => {
    const checks: DependencyCheck[] = [
      mkCheck({
        id: 'sf',
        label: 'Salesforce CLI',
        category: 'cli',
        remediation: 'Install sf',
        remediationUrl: 'https://dev.salesforce.com/'
      }),
      mkCheck({
        id: 'java',
        label: 'Java',
        category: 'runtime',
        ownerExtensionId: 'salesforce.apex'
      })
    ];
    const statuses = new Map<string, DependencyStatus>([
      ['sf', { state: 'fail', detail: 'not found' }],
      ['java', { state: 'ok', version: '17.0.1' }]
    ]);
    const out = formatReport(checks, statuses);
    expect(out).toContain('# Salesforce Extensions Manager — Dependency Report');
    expect(out).toContain('## CLIs');
    expect(out).toContain('## Runtimes');
    expect(out).toContain('- **Salesforce CLI**: FAIL — not found');
    expect(out).toContain('- **Java**: OK (17.0.1)');
    expect(out).toContain('required by `salesforce.apex`');
    expect(out).toContain('fix: Install sf (https://dev.salesforce.com/)');
  });
});
