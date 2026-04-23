import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  ExtensionService,
  MarketplaceVersionProbe,
  VsixInstallerLike,
  parseCliVersions
} from '../../src/services/extensionService';
import { SettingsService } from '../../src/services/settingsService';
import { CodeCliService } from '../../src/services/codeCliService';
import { Logger } from '../../src/util/logger';

const makeExt = (id: string, pkg: Record<string, unknown> = {}): vscode.Extension<unknown> =>
  ({ id, packageJSON: pkg } as unknown as vscode.Extension<unknown>);

describe('ExtensionService', () => {
  const mkSettings = (overrides: Partial<Record<keyof SettingsService, unknown>> = {}): SettingsService => ({
    getThirdPartyExtensionIds: jest.fn(() => ['redhat.vscode-xml']),
    getBackend: jest.fn(() => 'codeCli'),
    getUpdateCheck: jest.fn(() => 'manual' as const),
    ...overrides
  } as unknown as SettingsService);

  const mkCodeCli = (): CodeCliService => ({
    installExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    uninstallExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    listInstalledWithVersions: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
  } as unknown as CodeCliService);

  const mkLogger = (): Logger => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), dispose: jest.fn()
  } as unknown as Logger);

  beforeEach(() => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
    (vscode.extensions.getExtension as jest.Mock).mockReset();
    (vscode.commands.executeCommand as jest.Mock).mockReset();
    (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
  });

  it('managed() returns salesforce publisher + listed third parties', () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
      makeExt('salesforce.salesforcedx-vscode-core'),
      makeExt('redhat.vscode-xml'),
      makeExt('someone.unrelated')
    ];
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    expect(svc.managed().map(e => e.id)).toEqual([
      'salesforce.salesforcedx-vscode-core',
      'redhat.vscode-xml'
    ]);
  });

  it('enable() is a no-op when the extension is already installed', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(makeExt('salesforce.foo'));
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.enable('salesforce.foo');
    expect(outcome).toBe('ok');
    expect(cli.installExtension).not.toHaveBeenCalled();
  });

  it('enable() installs via code CLI when the extension is missing', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.enable('salesforce.foo');
    expect(outcome).toBe('ok');
    expect(cli.installExtension).toHaveBeenCalledWith('salesforce.foo');
  });

  it('enable() returns manual-required when install fails', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    const cli = {
      installExtension: jest.fn(async () => ({ stdout: '', stderr: 'network', exitCode: 1 })),
      uninstallExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
    } as unknown as CodeCliService;
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.enable('salesforce.foo');
    expect(outcome).toBe('manual-required');
  });

  it('enable() returns manual-required when backend is not codeCli', async () => {
    const svc = new ExtensionService(
      mkSettings({ getBackend: jest.fn(() => 'profiles') } as Partial<Record<keyof SettingsService, unknown>>),
      mkCodeCli(),
      mkLogger()
    );
    const outcome = await svc.enable('salesforce.foo');
    expect(outcome).toBe('manual-required');
  });

  it('disable() uninstalls via the code CLI when the extension is installed', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(makeExt('salesforce.foo'));
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.disable('salesforce.foo');
    expect(outcome).toBe('ok');
    expect(cli.uninstallExtension).toHaveBeenCalledWith('salesforce.foo');
  });

  it('disable() is a no-op when the extension is not installed', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.disable('salesforce.foo');
    expect(outcome).toBe('ok');
    expect(cli.uninstallExtension).not.toHaveBeenCalled();
  });

  it('disable() reports manual-required when uninstall fails', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(makeExt('salesforce.foo'));
    const cli = {
      installExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
      uninstallExtension: jest.fn(async () => ({ stdout: '', stderr: 'err', exitCode: 1 }))
    } as unknown as CodeCliService;
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.disable('salesforce.foo');
    expect(outcome).toBe('manual-required');
  });

  it('showManualToggleHint() opens the extensions view with a combined filter', async () => {
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    await svc.showManualToggleHint(['salesforce.a', 'salesforce.b'], 'Disable');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.extensions.search',
      '@installed salesforce.a @installed salesforce.b'
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('install() routes through VsixInstaller when a local vsix matches', async () => {
    const vsix: VsixInstallerLike = { tryInstall: jest.fn(async () => 'vsix') };
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    svc.setVsixInstaller(vsix);
    const result = await svc.install('salesforce.foo');
    expect(result.source).toBe('vsix');
    expect(cli.installExtension).not.toHaveBeenCalled();
  });

  it('install() surfaces a vsix failure when the VsixInstaller says skipped, without silently hitting marketplace', async () => {
    const vsix: VsixInstallerLike = { tryInstall: jest.fn(async () => 'skipped') };
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    svc.setVsixInstaller(vsix);
    const result = await svc.install('salesforce.foo');
    expect(result.source).toBe('vsix');
    expect(result.exitCode).not.toBe(0);
    expect(cli.installExtension).not.toHaveBeenCalled();
  });

  it('install() uses the marketplace CLI when no VsixInstaller is wired up', async () => {
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const result = await svc.install('salesforce.foo');
    expect(result.source).toBe('marketplace');
    expect(cli.installExtension).toHaveBeenCalledWith('salesforce.foo');
  });

  it('install() skips the marketplace attempt when the probe says the id is missing', async () => {
    const cli = mkCodeCli();
    const probe: MarketplaceVersionProbe = {
      getLatestVersion: jest.fn(async () => undefined),
      clearCache: jest.fn(),
      resolveExistence: jest.fn(async () => 'missing')
    };
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    svc.setMarketplaceProbe(probe);
    const result = await svc.install('salesforce.does-not-exist');
    expect(cli.installExtension).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('not published');
  });

  it('install() proceeds when the probe returns "unknown" (offline-safe)', async () => {
    const cli = mkCodeCli();
    const probe: MarketplaceVersionProbe = {
      getLatestVersion: jest.fn(async () => undefined),
      clearCache: jest.fn(),
      resolveExistence: jest.fn(async () => 'unknown')
    };
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    svc.setMarketplaceProbe(probe);
    const result = await svc.install('salesforce.foo');
    expect(result.exitCode).toBe(0);
    expect(cli.installExtension).toHaveBeenCalledWith('salesforce.foo');
  });

  it('uninstall() delegates to the code CLI', async () => {
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    await svc.uninstall('salesforce.foo');
    expect(cli.uninstallExtension).toHaveBeenCalledWith('salesforce.foo');
  });

  describe('dependency graph', () => {
    const makeGraphExt = (id: string, extensionDependencies: string[] = [], extensionPack: string[] = []) =>
      makeExt(id, { extensionDependencies, extensionPack });

    it('getDependencyGraph() reads extensionDependencies + extensionPack statically', () => {
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
        makeGraphExt('salesforce.apex', ['salesforce.core']),
        makeGraphExt('salesforce.core', []),
        makeGraphExt('salesforce.pack', [], ['salesforce.a', 'salesforce.b']),
        makeExt('salesforce.junk', { extensionDependencies: 'not-an-array' })
      ];
      const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
      const graph = svc.getDependencyGraph();
      expect(graph.get('salesforce.apex')!.dependsOn).toEqual(['salesforce.core']);
      expect(graph.get('salesforce.pack')!.packMembers).toEqual(['salesforce.a', 'salesforce.b']);
      expect(graph.get('salesforce.junk')!.dependsOn).toEqual([]);
    });

    it('getDependencyGraph() lowercases ids so mixed-case manifests fold to one key', () => {
      // Regression: `salesforcedx-vscode-agents` shipped with
      // `"publisher": "Salesforce"` (capital S) while every pack's
      // `extensionPack` list referenced `salesforce.salesforcedx-vscode-agents`.
      // Keying the graph on the raw `ext.id` made those look like two
      // distinct extensions and cascade-uninstall tried to remove the
      // same thing twice (second attempt failed with "not installed").
      (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
        makeGraphExt('Salesforce.salesforcedx-vscode-agents', []),
        makeGraphExt('salesforce.pack', [], ['salesforce.salesforcedx-vscode-agents'])
      ];
      const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
      const graph = svc.getDependencyGraph();
      expect(graph.has('Salesforce.salesforcedx-vscode-agents')).toBe(false);
      expect(graph.get('salesforce.salesforcedx-vscode-agents')).toBeDefined();
      expect(graph.get('salesforce.pack')!.packMembers).toEqual([
        'salesforce.salesforcedx-vscode-agents'
      ]);
    });

    it('topologicalUninstallOrder() deduplicates ids that differ only in casing', () => {
      // Belt-and-suspenders: even if a caller passes both casings, the
      // ordering routine should emit each underlying extension once.
      const graph = new Map([
        ['salesforce.salesforcedx-vscode-agents', {
          id: 'salesforce.salesforcedx-vscode-agents',
          dependsOn: [],
          packMembers: []
        }]
      ]);
      const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
      const order = svc.topologicalUninstallOrder(
        ['Salesforce.salesforcedx-vscode-agents', 'salesforce.salesforcedx-vscode-agents'],
        graph
      );
      expect(order).toEqual(['salesforce.salesforcedx-vscode-agents']);
    });

    it('transitiveDependents() walks the reverse edges', () => {
      const graph = new Map([
        ['apex', { id: 'apex', dependsOn: [], packMembers: [] }],
        ['apex-oas', { id: 'apex-oas', dependsOn: ['apex'], packMembers: [] }],
        ['apex-replay', { id: 'apex-replay', dependsOn: ['apex'], packMembers: [] }],
        ['unrelated', { id: 'unrelated', dependsOn: [], packMembers: [] }]
      ]);
      const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
      expect([...svc.transitiveDependents(['apex'], graph)].sort()).toEqual([
        'apex-oas',
        'apex-replay'
      ]);
    });

    it('transitiveDependents() treats extensionPack membership as a reverse edge', () => {
      const graph = new Map([
        ['pack', { id: 'pack', dependsOn: [], packMembers: ['member'] }],
        ['member', { id: 'member', dependsOn: [], packMembers: [] }]
      ]);
      const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
      expect([...svc.transitiveDependents(['member'], graph)]).toEqual(['pack']);
    });

    it('transitiveDependencies() walks extensionDependencies edges', () => {
      const graph = new Map([
        ['a', { id: 'a', dependsOn: ['b'], packMembers: [] }],
        ['b', { id: 'b', dependsOn: ['c'], packMembers: [] }],
        ['c', { id: 'c', dependsOn: [], packMembers: [] }],
        ['unrelated', { id: 'unrelated', dependsOn: [], packMembers: [] }]
      ]);
      const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
      expect([...svc.transitiveDependencies(['a'], graph)].sort()).toEqual(['b', 'c']);
    });

    it('computeBlockedByDependents() refuses to disable an id still needed by an outside-candidate extension', () => {
      const graph = new Map([
        ['apex', { id: 'apex', dependsOn: ['core'], packMembers: [] }],
        ['core', { id: 'core', dependsOn: [], packMembers: [] }]
      ]);
      const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
      const blocked = svc.computeBlockedByDependents(new Set(['core']), graph);
      expect(blocked.get('core')).toEqual(['apex']);
    });

    it('computeBlockedByDependents() iterates to a fixed point — removing one can free another', () => {
      // Candidates: { apex, core }. apex depends on core, but apex IS a candidate so core is safe.
      const graph = new Map([
        ['apex', { id: 'apex', dependsOn: ['core'], packMembers: [] }],
        ['core', { id: 'core', dependsOn: [], packMembers: [] }]
      ]);
      const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
      const blocked = svc.computeBlockedByDependents(new Set(['apex', 'core']), graph);
      expect(blocked.size).toBe(0);
    });

    it('topologicalUninstallOrder() puts dependents before dependencies', () => {
      const graph = new Map([
        ['apex', { id: 'apex', dependsOn: ['core'], packMembers: [] }],
        ['core', { id: 'core', dependsOn: [], packMembers: [] }]
      ]);
      const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
      const order = svc.topologicalUninstallOrder(['core', 'apex'], graph);
      expect(order.indexOf('apex')).toBeLessThan(order.indexOf('core'));
    });

    describe('disk-backed graph augmentation', () => {
      let tmp: string;
      const originalEnv = process.env.VSCODE_EXTENSIONS;

      beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdx-mgr-ext-'));
        process.env.VSCODE_EXTENSIONS = tmp;
      });
      afterEach(() => {
        process.env.VSCODE_EXTENSIONS = originalEnv;
        fs.rmSync(tmp, { recursive: true, force: true });
      });

      const writeInstalled = (
        id: string,
        version: string,
        manifest: Record<string, unknown>
      ): void => {
        const extDir = path.join(tmp, `${id}-${version}`);
        fs.mkdirSync(extDir, { recursive: true });
        fs.writeFileSync(path.join(extDir, 'package.json'), JSON.stringify(manifest));
      };

      it('getDependencyGraph picks up ids installed on disk that vscode.extensions.all does not know about', () => {
        // vscode.extensions.all is empty — mimics the "installed after window
        // startup" case. Disk-augmentation should still surface the node.
        writeInstalled('salesforce.salesforcedx-vscode-apex-oas', '63.1.0', {
          name: 'salesforcedx-vscode-apex-oas',
          publisher: 'salesforce',
          extensionDependencies: [
            'salesforce.salesforcedx-vscode-apex',
            'salesforce.salesforcedx-einstein-gpt'
          ]
        });
        (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        const graph = svc.getDependencyGraph();
        const node = graph.get('salesforce.salesforcedx-vscode-apex-oas');
        expect(node?.dependsOn).toEqual([
          'salesforce.salesforcedx-vscode-apex',
          'salesforce.salesforcedx-einstein-gpt'
        ]);
      });

      it('runtime vscode.extensions.all entries win over disk entries for the same id', () => {
        writeInstalled('salesforce.apex', '63.0.0', {
          extensionDependencies: ['salesforce.stale-from-disk']
        });
        (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
          makeExt('salesforce.apex', {
            extensionDependencies: ['salesforce.current-from-runtime']
          })
        ];
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        expect(svc.getDependencyGraph().get('salesforce.apex')?.dependsOn).toEqual([
          'salesforce.current-from-runtime'
        ]);
      });

      it('getDisplayName prefers the runtime packageJSON when available', () => {
        writeInstalled('salesforce.einstein-gpt', '3.32.0', {
          displayName: 'Agentforce Vibes (disk)'
        });
        // Mock path used by getDisplayName is
        // `vscode.extensions.getExtension(id)?.packageJSON`. `.all` is
        // irrelevant here — the runtime lookup goes through getExtension.
        (vscode.extensions.getExtension as jest.Mock).mockImplementation((qid: string) =>
          qid === 'salesforce.einstein-gpt'
            ? makeExt('salesforce.einstein-gpt', { displayName: 'Agentforce Vibes' })
            : undefined
        );
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        expect(svc.getDisplayName('salesforce.einstein-gpt')).toBe('Agentforce Vibes');
      });

      it('getDisplayName falls back to the on-disk manifest for mid-session installs', () => {
        writeInstalled('salesforce.einstein-gpt', '3.32.0', {
          displayName: 'Agentforce Vibes'
        });
        // Not in vscode.extensions.all — mimics "installed after window startup"
        (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        expect(svc.getDisplayName('salesforce.einstein-gpt')).toBe('Agentforce Vibes');
      });

      it('getDisplayName returns undefined when nothing knows the id', () => {
        (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        expect(svc.getDisplayName('nobody.knows')).toBeUndefined();
      });

      it('label() returns the runtime displayName when installed', () => {
        (vscode.extensions.getExtension as jest.Mock).mockImplementation((qid: string) =>
          qid === 'salesforce.einstein-gpt'
            ? makeExt('salesforce.einstein-gpt', { displayName: 'Agentforce Vibes' })
            : undefined
        );
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        expect(svc.label('salesforce.einstein-gpt')).toBe('Agentforce Vibes');
      });

      it('label() falls back to the marketplace catalog lookup for uninstalled ids', () => {
        (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        svc.setCatalogDisplayNameLookup(id =>
          id === 'salesforce.einstein-gpt' ? 'Agentforce Vibes' : undefined
        );
        expect(svc.label('salesforce.einstein-gpt')).toBe('Agentforce Vibes');
      });

      it('label() returns the raw id when no resolver knows it', () => {
        (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        expect(svc.label('nobody.knows')).toBe('nobody.knows');
      });
    });

    describe('isLocked', () => {
      // isLocked BFS-expands manager's own package.json extensionDependencies
      // through installed extensions' manifests, so we prime `getExtension`
      // for the self-id and for each hop.
      const EXT_MANAGER = 'salesforce.salesforcedx-vscode-manager';
      const EXT_CORE = 'salesforce.salesforcedx-vscode-core';
      const EXT_SERVICES = 'salesforce.salesforcedx-vscode-services';

      const seedExtensions = (map: Record<string, Record<string, unknown>>): void => {
        (vscode.extensions.getExtension as jest.Mock).mockImplementation((id: string) =>
          map[id] ? makeExt(id, map[id]) : undefined
        );
      };

      it('returns true for a direct extensionDependencies entry', () => {
        seedExtensions({
          [EXT_MANAGER]: { extensionDependencies: [EXT_CORE] },
          [EXT_CORE]: {}
        });
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        expect(svc.isLocked(EXT_CORE)).toBe(true);
      });

      it('BFS-expands through the installed manifest chain', () => {
        // manager → core → services: services is transitively locked
        // because core's own extensionDependencies pulls it.
        seedExtensions({
          [EXT_MANAGER]: { extensionDependencies: [EXT_CORE] },
          [EXT_CORE]: { extensionDependencies: [EXT_SERVICES] },
          [EXT_SERVICES]: {}
        });
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        expect(svc.isLocked(EXT_SERVICES)).toBe(true);
      });

      it('returns false for unrelated ids', () => {
        seedExtensions({
          [EXT_MANAGER]: { extensionDependencies: [EXT_CORE] },
          [EXT_CORE]: {}
        });
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        expect(svc.isLocked('salesforce.unrelated')).toBe(false);
      });

      it('returns false when manager has no extensionDependencies', () => {
        seedExtensions({
          [EXT_MANAGER]: {}
        });
        const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
        expect(svc.isLocked(EXT_CORE)).toBe(false);
      });
    });

    it('topologicalUninstallOrder() puts the containing pack before its members', () => {
      // VSCode treats `extensionPack` like `extensionDependencies`: the pack
      // must be removed before its members so VSCode doesn't block the
      // member uninstalls with "pack depends on this".
      const graph = new Map([
        ['pack', { id: 'pack', dependsOn: [], packMembers: ['a', 'b'] }],
        ['a', { id: 'a', dependsOn: [], packMembers: [] }],
        ['b', { id: 'b', dependsOn: [], packMembers: [] }]
      ]);
      const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
      const order = svc.topologicalUninstallOrder(['a', 'b', 'pack'], graph);
      expect(order.indexOf('pack')).toBeLessThan(order.indexOf('a'));
      expect(order.indexOf('pack')).toBeLessThan(order.indexOf('b'));
    });
  });

  it('readManifest() returns the packageJSON of an installed extension without activating it', () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { name: 'foo', salesforceDependencies: [{ id: 'java' }] })
    );
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    expect(svc.readManifest('salesforce.foo')).toEqual({
      name: 'foo',
      salesforceDependencies: [{ id: 'java' }]
    });
  });

  it('getInstalledVersion() reads packageJSON.version statically', () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { version: '63.0.0' })
    );
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    expect(svc.getInstalledVersion('salesforce.foo')).toBe('63.0.0');
  });

  it('getInstalledVersion() returns undefined when the extension is not installed', () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    expect(svc.getInstalledVersion('salesforce.foo')).toBeUndefined();
  });

  it('install() with force passes --force to the code CLI', async () => {
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    await svc.install('salesforce.foo', { force: true });
    expect(cli.installExtension).toHaveBeenCalledWith('salesforce.foo', true);
  });

  it('getNodeVersionInfo() reports no update when there is no probe', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { version: '63.0.0' })
    );
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    const info = await svc.getNodeVersionInfo('salesforce.foo');
    expect(info.installedVersion).toBe('63.0.0');
    expect(info.latestVersion).toBeUndefined();
    expect(info.updateAvailable).toBe(false);
    expect(info.source).toBe('unknown');
  });

  it('getNodeVersionInfo() reports updateAvailable when the marketplace version is newer', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { version: '63.0.0' })
    );
    const probe: MarketplaceVersionProbe = {
      getLatestVersion: jest.fn(async () => '63.1.0'),
      clearCache: jest.fn()
    };
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    svc.setMarketplaceProbe(probe);
    svc.setInstallSourceLookup(() => 'marketplace');
    const info = await svc.getNodeVersionInfo('salesforce.foo');
    expect(info.installedVersion).toBe('63.0.0');
    expect(info.latestVersion).toBe('63.1.0');
    expect(info.updateAvailable).toBe(true);
    expect(info.source).toBe('marketplace');
  });

  it('getNodeVersionInfo() is not updateAvailable when versions match', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { version: '63.0.0' })
    );
    const probe: MarketplaceVersionProbe = {
      getLatestVersion: jest.fn(async () => '63.0.0'),
      clearCache: jest.fn()
    };
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    svc.setMarketplaceProbe(probe);
    const info = await svc.getNodeVersionInfo('salesforce.foo');
    expect(info.updateAvailable).toBe(false);
  });

  it('getNodeVersionInfo() skips the marketplace probe when updateCheck=never', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { version: '63.0.0' })
    );
    const probe: MarketplaceVersionProbe = {
      getLatestVersion: jest.fn(async () => '63.9.9'),
      clearCache: jest.fn()
    };
    const svc = new ExtensionService(
      mkSettings({ getUpdateCheck: jest.fn(() => 'never' as const) } as Partial<Record<keyof SettingsService, unknown>>),
      mkCodeCli(),
      mkLogger()
    );
    svc.setMarketplaceProbe(probe);
    const info = await svc.getNodeVersionInfo('salesforce.foo');
    expect(probe.getLatestVersion).not.toHaveBeenCalled();
    expect(info.updateAvailable).toBe(false);
  });

  it('getNodeVersionInfo() falls back to the CLI version map when packageJSON is missing', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    const cli = mkCodeCli();
    (cli.listInstalledWithVersions as jest.Mock).mockResolvedValue({
      stdout: 'salesforce.foo@62.0.0\nsalesforce.bar@1.2.3\n',
      stderr: '',
      exitCode: 0
    });
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    await svc.refreshInstalledCliVersions();
    const info = await svc.getNodeVersionInfo('salesforce.foo');
    expect(info.installedVersion).toBe('62.0.0');
  });

  it('parseCliVersions tolerates blank lines and malformed rows', () => {
    const map = parseCliVersions('salesforce.foo@1.0.0\n\nbad-line\nsalesforce.bar@2.0.0\n');
    expect(map.get('salesforce.foo')).toBe('1.0.0');
    expect(map.get('salesforce.bar')).toBe('2.0.0');
    expect(map.size).toBe(2);
  });
});
