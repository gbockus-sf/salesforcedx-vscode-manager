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
    // lwc shim shares its fingerprint with builtin.node, so it's folded in.
    expect(results.has('lwc.node')).toBe(false);
  });

  describe('logical-check fingerprint dedupe', () => {
    it('merges two manifests that declare the same env check under different ids', async () => {
      const apexDeps: DependencyCheck[] = [
        {
          id: 'apex.java-jdk',
          label: 'Java JDK 11+ (apex)',
          category: 'runtime',
          check: {
            type: 'env',
            env: 'JAVA_HOME',
            fallback: {
              type: 'exec',
              command: 'java',
              args: ['-version'],
              minVersion: '11.0.0'
            }
          }
        }
      ];
      const soqlDeps: DependencyCheck[] = [
        {
          id: 'soql.java-jdk',
          label: 'Java JDK 17+ (soql)',
          category: 'runtime',
          check: {
            type: 'env',
            env: 'JAVA_HOME'
          }
        }
      ];
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
        makeExt('salesforce.salesforcedx-vscode-apex', { salesforceDependencies: apexDeps }),
        makeExt('salesforce.salesforcedx-vscode-soql', { salesforceDependencies: soqlDeps })
      ];
      const registry = new DependencyRegistry(mkRunners());
      const checks = await registry.collect();

      const java = checks.find(c => c.id === 'apex.java-jdk');
      expect(java).toBeDefined();
      // Earliest-precedence (apex, first iterated) wins metadata.
      expect(java?.label).toBe('Java JDK 11+ (apex)');
      // Both extensions are recorded as owners.
      expect(java?.ownerExtensionIds).toEqual([
        'salesforce.salesforcedx-vscode-apex',
        'salesforce.salesforcedx-vscode-soql'
      ]);
      expect(java?.ownerExtensionId).toBe('salesforce.salesforcedx-vscode-apex');
      // The second declaration did not produce its own row.
      expect(checks.find(c => c.id === 'soql.java-jdk')).toBeUndefined();
    });

    it('merges a manifest declaration into a built-in; built-in metadata wins, manifest owner preserved', async () => {
      const declared: DependencyCheck[] = [
        {
          id: 'myext.node',
          label: 'Node (myext)',
          category: 'runtime',
          check: { type: 'nodeVersion', minVersion: '18.0.0' }
        }
      ];
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
        makeExt('acme.myext', { salesforceDependencies: declared })
      ];
      const registry = new DependencyRegistry(mkRunners());
      const checks = await registry.collect();

      const node = checks.find(c => c.id === 'builtin.node');
      expect(node).toBeDefined();
      expect(node?.label).toBe('Node.js 18+');
      expect(node?.ownerExtensionIds).toEqual(['acme.myext']);
      expect(node?.ownerExtensionId).toBe('acme.myext');
      // Manifest declaration did not produce a separate row.
      expect(checks.find(c => c.id === 'myext.node')).toBeUndefined();
    });

    it('does NOT merge exec checks that differ by minVersion', async () => {
      const a: DependencyCheck[] = [
        {
          id: 'ext-a.sf',
          label: 'SF CLI a',
          category: 'cli',
          check: { type: 'exec', command: 'sf', args: ['--version'], minVersion: '2.0.0' }
        }
      ];
      const b: DependencyCheck[] = [
        {
          id: 'ext-b.sf',
          label: 'SF CLI b',
          category: 'cli',
          check: { type: 'exec', command: 'sf', args: ['--version'], minVersion: '3.0.0' }
        }
      ];
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
        makeExt('acme.a', { salesforceDependencies: a }),
        makeExt('acme.b', { salesforceDependencies: b })
      ];
      const registry = new DependencyRegistry(mkRunners());
      const checks = await registry.collect();

      // builtin.sf-cli is minVersion 2.0.0, so it folds with ext-a.sf.
      const sfA = checks.find(c => c.id === 'builtin.sf-cli');
      expect(sfA?.ownerExtensionIds).toEqual(['acme.a']);
      // ext-b.sf has minVersion 3.0.0 → different fingerprint → separate row.
      const sfB = checks.find(c => c.id === 'ext-b.sf');
      expect(sfB).toBeDefined();
      expect(sfB?.ownerExtensionIds).toEqual(['acme.b']);
    });

    it('merges env declarations with different fallbacks (fallback is not part of the fingerprint)', async () => {
      const a: DependencyCheck[] = [
        {
          id: 'a.java',
          label: 'Java a',
          category: 'runtime',
          check: {
            type: 'env',
            env: 'JAVA_HOME',
            fallback: { type: 'exec', command: 'java', args: ['-version'], minVersion: '11.0.0' }
          }
        }
      ];
      const b: DependencyCheck[] = [
        {
          id: 'b.java',
          label: 'Java b',
          category: 'runtime',
          check: {
            type: 'env',
            env: 'JAVA_HOME',
            fallback: { type: 'exec', command: 'java', args: ['-version'], minVersion: '21.0.0' }
          }
        }
      ];
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
        makeExt('acme.a', { salesforceDependencies: a }),
        makeExt('acme.b', { salesforceDependencies: b })
      ];
      const registry = new DependencyRegistry(mkRunners());
      const checks = await registry.collect();

      const java = checks.find(c => c.id === 'a.java');
      expect(java).toBeDefined();
      expect(java?.ownerExtensionIds).toEqual(['acme.a', 'acme.b']);
      expect(checks.find(c => c.id === 'b.java')).toBeUndefined();
    });

    it('built-in checks without an owner have no ownerExtensionIds property', async () => {
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
      const registry = new DependencyRegistry(mkRunners());
      const checks = await registry.collect();
      const git = checks.find(c => c.id === 'builtin.git');
      expect(git).toBeDefined();
      expect(git?.ownerExtensionId).toBeUndefined();
      expect(git?.ownerExtensionIds).toBeUndefined();
    });
  });

  describe('isInstalled lookup', () => {
    it('drops shim entries for extensions that have been uninstalled mid-session', async () => {
      // Regression: applying the Lightning group uninstalls Apex, but
      // vscode.extensions.all still lists it (startup snapshot). The
      // injected isInstalled lookup reads disk state and reports the
      // true answer, so the shim-contributed Java dep disappears.
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
        makeExt('salesforce.salesforcedx-vscode-apex'),
        makeExt('salesforce.salesforcedx-vscode-core')
      ];
      const registry = new DependencyRegistry(mkRunners());
      registry.setIsInstalledLookup(id => id !== 'salesforce.salesforcedx-vscode-apex');
      const checks = await registry.collect();
      expect(checks.find(c => c.id === 'apex.java')).toBeUndefined();
      // Core is still installed → its sf-cli shim is still there.
      expect(checks.find(c => c.label === 'Salesforce CLI (sf)')).toBeDefined();
    });

    it('drops manifest-declared deps for extensions that have been uninstalled', async () => {
      const declared: DependencyCheck[] = [
        {
          id: 'vibes.custom',
          label: 'Vibes Custom',
          category: 'per-extension',
          check: { type: 'file', path: '/tmp/vibes' }
        }
      ];
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
        makeExt('salesforce.salesforcedx-einstein-gpt', { salesforceDependencies: declared })
      ];
      const registry = new DependencyRegistry(mkRunners());
      registry.setIsInstalledLookup(() => false);
      const checks = await registry.collect();
      expect(checks.find(c => c.id === 'vibes.custom')).toBeUndefined();
    });

    it('preserves legacy behavior when no lookup is wired', async () => {
      // Tests + bare environments that don't plug the hook keep
      // seeing every dep, same as before.
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
        makeExt('salesforce.salesforcedx-vscode-apex')
      ];
      const registry = new DependencyRegistry(mkRunners());
      const checks = await registry.collect();
      expect(checks.find(c => c.id === 'apex.java')).toBeDefined();
    });
  });
});
