import * as vscode from 'vscode';
import { DependencyRegistry } from '../../src/dependencies/registry';
import { DependencyRunners } from '../../src/dependencies/runners';
import { ProcessService } from '../../src/services/processService';
import type { DependencyCheck } from '../../src/dependencies/types';

const makeExt = (id: string, pkg: Record<string, unknown> = {}): vscode.Extension<unknown> =>
  ({ id, packageJSON: pkg }) as unknown as vscode.Extension<unknown>;

const mkRunners = (): DependencyRunners => {
  const proc = {
    run: jest.fn(async () => ({ stdout: 'x 9.9.9', stderr: '', exitCode: 0 }))
  } as unknown as ProcessService;
  return new DependencyRunners(proc);
};

describe('DependencyRegistry', () => {
  beforeEach(() => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
    (vscode.extensions.getExtension as jest.Mock).mockReset();
  });

  it('picks up declared salesforceDependencies WITHOUT activating the extension', async () => {
    const declared: DependencyCheck[] = [
      {
        id: 'my-ext.custom',
        label: 'Custom',
        category: 'per-extension',
        check: { type: 'file', path: '/tmp/x' }
      }
    ];
    const activate = jest.fn();
    (vscode.extensions as unknown as { all: unknown[] }).all = [
      {
        id: 'salesforce.hypothetical',
        packageJSON: { salesforceDependencies: declared },
        activate
      }
    ];
    const registry = new DependencyRegistry(mkRunners());
    const checks = await registry.collect();

    expect(activate).not.toHaveBeenCalled();
    expect(checks.find(c => c.id === 'my-ext.custom')).toBeDefined();
    expect(checks.find(c => c.id === 'my-ext.custom')?.ownerExtensionId).toBe('salesforce.hypothetical');
  });

  it('falls back to the shim catalog for extensions without salesforceDependencies', async () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
      makeExt('salesforce.salesforcedx-vscode-apex', { name: 'apex' })
    ];
    const registry = new DependencyRegistry(mkRunners());
    const checks = await registry.collect();
    const apexJava = checks.find(c => c.id === 'apex.java');
    expect(apexJava).toBeDefined();
    expect(apexJava?.ownerExtensionId).toBe('salesforce.salesforcedx-vscode-apex');
  });

  it('prefers declared deps over shims when both exist for the same extension', async () => {
    const declared: DependencyCheck[] = [
      {
        id: 'apex.custom-java',
        label: 'Custom Java Check',
        category: 'runtime',
        check: { type: 'nodeVersion', minVersion: '1.0.0' }
      }
    ];
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
      makeExt('salesforce.salesforcedx-vscode-apex', { salesforceDependencies: declared })
    ];
    const registry = new DependencyRegistry(mkRunners());
    const checks = await registry.collect();
    expect(checks.find(c => c.id === 'apex.custom-java')).toBeDefined();
    // shim is suppressed because the extension declared its own.
    expect(checks.find(c => c.id === 'apex.java')).toBeUndefined();
  });

  it('always injects built-in cli/runtime checks (sf, git, node)', async () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
    const registry = new DependencyRegistry(mkRunners());
    const checks = await registry.collect();
    const ids = checks.map(c => c.id);
    expect(ids).toContain('builtin.sf-cli');
    expect(ids).toContain('builtin.git');
    expect(ids).toContain('builtin.node');
    const sfCli = checks.find(c => c.id === 'builtin.sf-cli');
    expect(sfCli?.ownerExtensionId).toBeUndefined();
    expect(sfCli?.category).toBe('cli');
  });

  it('runOne() executes a registered check via the runners', async () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
    const registry = new DependencyRegistry(mkRunners());
    const status = await registry.runOne('builtin.node');
    expect(status.state).toBe('ok');
  });

  it('runOne() returns unknown when the id is not registered', async () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
    const registry = new DependencyRegistry(mkRunners());
    const status = await registry.runOne('does.not.exist');
    expect(status.state).toBe('unknown');
  });

  it('runAll() returns one result per registered check', async () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
      makeExt('salesforce.salesforcedx-vscode-lwc')
    ];
    const registry = new DependencyRegistry(mkRunners());
    const results = await registry.runAll();
    const checks = await registry.collect();
    expect(results.size).toBe(checks.length);
    expect(results.has('builtin.node')).toBe(true);
    expect(results.has('lwc.node')).toBe(true);
  });
});
