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
  runAll: jest.fn(async () => new Map(Object.entries(statuses)))
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
