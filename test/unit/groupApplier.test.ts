import { applyGroup } from '../../src/groups/groupApplier';
import type {
  DependencyGraph,
  DependencyGraphNode,
  ExtensionService,
  InstallOutcome
} from '../../src/services/extensionService';
import type { Group } from '../../src/groups/types';

const emptyGraph = (): DependencyGraph => new Map<string, DependencyGraphNode>();

const mkSvc = (overrides: Partial<Record<keyof ExtensionService, unknown>> = {}): ExtensionService => ({
  isInstalled: jest.fn((_id: string) => true),
  install: jest.fn(async (): Promise<InstallOutcome> => ({ source: 'marketplace', exitCode: 0 })),
  enable: jest.fn(async () => 'ok'),
  disable: jest.fn(async () => 'ok'),
  getDependencyGraph: jest.fn(() => emptyGraph()),
  transitiveDependencies: jest.fn((_roots: readonly string[], _graph: DependencyGraph) => new Set<string>()),
  computeBlockedByDependents: jest.fn(() => new Map<string, string[]>()),
  topologicalUninstallOrder: jest.fn((ids: readonly string[]) => [...ids]),
  ...overrides
} as unknown as ExtensionService);

const group: Group = {
  id: 'apex',
  label: 'Apex',
  extensions: ['salesforce.apex', 'salesforce.core'],
  builtIn: true
};

describe('applyGroup', () => {
  it('enables every member when all are installed', async () => {
    const svc = mkSvc();
    const r = await applyGroup(group, 'enableOnly', [], svc);
    expect(svc.enable).toHaveBeenCalledWith('salesforce.apex');
    expect(svc.enable).toHaveBeenCalledWith('salesforce.core');
    expect(r.enabled).toEqual(['salesforce.apex', 'salesforce.core']);
    expect(r.disabled).toEqual([]);
  });

  it('installs missing members before enabling them', async () => {
    const installed = new Set(['salesforce.core']);
    const svc = mkSvc({
      isInstalled: jest.fn((id: string) => installed.has(id)),
      install: jest.fn(async (id: string): Promise<InstallOutcome> => {
        installed.add(id);
        return { source: 'marketplace', exitCode: 0 };
      })
    });
    const r = await applyGroup(group, 'enableOnly', [], svc);
    expect(svc.install).toHaveBeenCalledWith('salesforce.apex');
    expect(svc.install).not.toHaveBeenCalledWith('salesforce.core');
    expect(r.enabled).toEqual(['salesforce.apex', 'salesforce.core']);
  });

  it('records VSIX-sourced installs separately', async () => {
    const installed = new Set<string>();
    const svc = mkSvc({
      isInstalled: jest.fn((id: string) => installed.has(id)),
      install: jest.fn(async (id: string): Promise<InstallOutcome> => {
        installed.add(id);
        return { source: 'vsix', exitCode: 0 };
      })
    });
    const r = await applyGroup(group, 'enableOnly', [], svc);
    expect(r.installedFromVsix).toEqual(['salesforce.apex', 'salesforce.core']);
  });

  it('skips a member whose install fails', async () => {
    const installed = new Set(['salesforce.core']);
    const svc = mkSvc({
      isInstalled: jest.fn((id: string) => installed.has(id)),
      install: jest.fn(async (): Promise<InstallOutcome> => ({ source: 'marketplace', exitCode: 1 }))
    });
    const r = await applyGroup(group, 'enableOnly', [], svc);
    expect(r.skipped).toEqual([{ id: 'salesforce.apex', reason: 'install failed (exit 1)' }]);
    expect(r.enabled).toEqual(['salesforce.core']);
  });

  it('with scope=disableOthers, disables managed ids that are not members', async () => {
    const svc = mkSvc();
    const managed = ['salesforce.apex', 'salesforce.core', 'salesforce.lwc', 'redhat.vscode-xml'];
    const r = await applyGroup(group, 'disableOthers', managed, svc);
    expect(r.disabled).toEqual(['salesforce.lwc', 'redhat.vscode-xml']);
    expect(svc.disable).toHaveBeenCalledWith('salesforce.lwc');
    expect(svc.disable).toHaveBeenCalledWith('redhat.vscode-xml');
    expect(svc.disable).not.toHaveBeenCalledWith('salesforce.apex');
  });

  it('with scope=enableOnly, never calls disable', async () => {
    const svc = mkSvc();
    const managed = ['salesforce.apex', 'salesforce.lwc'];
    await applyGroup(group, 'enableOnly', managed, svc);
    expect(svc.disable).not.toHaveBeenCalled();
  });

  it('disableOthers skips non-installed managed extensions', async () => {
    const svc = mkSvc({
      isInstalled: jest.fn((id: string) => id !== 'salesforce.lwc')
    });
    const r = await applyGroup(group, 'disableOthers', ['salesforce.lwc'], svc);
    expect(r.disabled).toEqual([]);
    expect(svc.disable).not.toHaveBeenCalled();
  });

  it('auto-includes transitive extensionDependencies of members', async () => {
    const autoIncluded = new Set(['salesforce.services']);
    const svc = mkSvc({
      transitiveDependencies: jest.fn(() => autoIncluded)
    });
    const r = await applyGroup(group, 'enableOnly', [], svc);
    expect(r.dependencyAutoIncluded).toEqual(['salesforce.services']);
    expect(svc.enable).toHaveBeenCalledWith('salesforce.services');
  });

  it('refuses to disable an extension that is depended on by an installed outside-group extension', async () => {
    const svc = mkSvc({
      computeBlockedByDependents: jest.fn(
        () => new Map([['salesforce.core', ['salesforce.agentforce']]])
      )
    });
    const managed = ['salesforce.apex', 'salesforce.core', 'salesforce.agentforce'];
    const r = await applyGroup(
      { id: 'x', label: 'X', extensions: ['salesforce.apex'] },
      'disableOthers',
      managed,
      svc
    );
    expect(r.dependencyBlocked).toEqual([
      { id: 'salesforce.core', blockedBy: ['salesforce.agentforce'] }
    ]);
    expect(svc.disable).not.toHaveBeenCalledWith('salesforce.core');
  });

  it('excludes deps of freshly-installed members from the disable candidate set', async () => {
    // Regression for the apex-oas / einstein-gpt case: if a group member
    // isn't installed until the apply runs, its extensionDependencies
    // only become known to us AFTER install. A naive implementation
    // would compute the blocker set from the pre-install graph, miss the
    // new edge, and try to uninstall the freshly-pulled-in dep.
    const preGraph = new Map<string, DependencyGraphNode>();
    preGraph.set('salesforce.apex', { id: 'salesforce.apex', dependsOn: [], packMembers: [] });
    const postGraph = new Map<string, DependencyGraphNode>();
    postGraph.set('salesforce.apex', { id: 'salesforce.apex', dependsOn: [], packMembers: [] });
    postGraph.set('salesforce.apex-oas', {
      id: 'salesforce.apex-oas',
      dependsOn: ['salesforce.einstein-gpt'],
      packMembers: []
    });
    postGraph.set('salesforce.einstein-gpt', {
      id: 'salesforce.einstein-gpt',
      dependsOn: [],
      packMembers: []
    });

    let callCount = 0;
    const svc = mkSvc({
      getDependencyGraph: jest.fn(() => (callCount++ === 0 ? preGraph : postGraph)),
      transitiveDependencies: jest.fn(
        (roots: readonly string[], graph: DependencyGraph) => {
          // Real impl walks edges; simulate here.
          const out = new Set<string>();
          const stack = [...roots];
          while (stack.length) {
            const id = stack.pop()!;
            const node = graph.get(id);
            if (!node) continue;
            for (const d of node.dependsOn) if (!out.has(d)) { out.add(d); stack.push(d); }
          }
          return out;
        }
      )
    });
    const members = ['salesforce.apex', 'salesforce.apex-oas'];
    const managed = [...members, 'salesforce.einstein-gpt'];
    const r = await applyGroup(
      { id: 'apex', label: 'Apex', extensions: members },
      'disableOthers',
      managed,
      svc
    );
    // einstein-gpt must not appear in the disable set; it was pulled in
    // by apex-oas and is part of the transitive deps post-install.
    expect(svc.disable).not.toHaveBeenCalledWith('salesforce.einstein-gpt');
    expect(r.disabled).toEqual([]);
    expect(r.dependencyAutoIncluded).toContain('salesforce.einstein-gpt');
  });

  it('disables non-members in topological order', async () => {
    const disableCalls: string[] = [];
    const svc = mkSvc({
      disable: jest.fn(async (id: string) => { disableCalls.push(id); return 'ok'; }),
      topologicalUninstallOrder: jest.fn((ids: readonly string[]) =>
        // reverse to prove the order is what the service returns, not insertion order
        [...ids].reverse()
      )
    });
    const managed = ['salesforce.a', 'salesforce.b', 'salesforce.c'];
    await applyGroup({ id: 'x', label: 'X', extensions: [] }, 'disableOthers', managed, svc);
    expect(disableCalls).toEqual(['salesforce.c', 'salesforce.b', 'salesforce.a']);
  });
});
