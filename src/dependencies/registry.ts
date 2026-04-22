import * as vscode from 'vscode';
import { DependencyRunners } from './runners';
import { shimCatalog } from './shimCatalog';
import type { DependencyCheck, DependencyStatus } from './types';

/**
 * Top-level built-in checks injected for every workspace regardless of which
 * Salesforce extensions are installed. These are the lowest common
 * denominator the manager itself needs (Salesforce CLI, git, Node).
 */
const BUILT_IN_CHECKS: DependencyCheck[] = [
  {
    id: 'builtin.sf-cli',
    label: 'Salesforce CLI (sf)',
    category: 'cli',
    check: {
      type: 'exec',
      command: 'sf',
      args: ['--version'],
      minVersion: '2.0.0'
    },
    remediation: 'Install the Salesforce CLI (sf).',
    remediationUrl: 'https://developer.salesforce.com/tools/salesforcecli'
  },
  {
    id: 'builtin.git',
    label: 'Git',
    category: 'cli',
    check: {
      type: 'exec',
      command: 'git',
      args: ['--version']
    },
    remediation: 'Install Git.',
    remediationUrl: 'https://git-scm.com/'
  },
  {
    id: 'builtin.node',
    label: 'Node.js 18+',
    category: 'runtime',
    check: {
      type: 'nodeVersion',
      minVersion: '18.0.0'
    },
    remediation: 'Install Node.js 18 or newer.',
    remediationUrl: 'https://nodejs.org/'
  }
];

interface ManifestWithDeps {
  salesforceDependencies?: DependencyCheck[];
}

export class DependencyRegistry {
  private cache: DependencyCheck[] | undefined;

  constructor(private readonly runners: DependencyRunners) {}

  /**
   * Scans every installed extension's `packageJSON.salesforceDependencies`
   * (read statically — no activation) and merges in shim catalog entries for
   * extensions that have not declared their own contract. Always prepends the
   * top-level built-in checks (sf CLI, git, node).
   */
  async collect(): Promise<DependencyCheck[]> {
    const checks: DependencyCheck[] = [];
    const seenIds = new Set<string>();

    const push = (c: DependencyCheck): void => {
      if (seenIds.has(c.id)) return;
      seenIds.add(c.id);
      checks.push(c);
    };

    for (const b of BUILT_IN_CHECKS) push(b);

    const declared = new Set<string>();
    for (const ext of vscode.extensions.all) {
      const pkg = ext.packageJSON as ManifestWithDeps | undefined;
      const deps = pkg?.salesforceDependencies;
      if (Array.isArray(deps) && deps.length > 0) {
        declared.add(ext.id);
        for (const raw of deps) {
          // Tag with owner if the manifest didn't already; categorize as
          // per-extension by default.
          push({
            ...raw,
            category: raw.category ?? 'per-extension',
            ownerExtensionId: raw.ownerExtensionId ?? ext.id
          });
        }
      }
    }

    // Merge shim catalog entries for every known-installed ext that has NOT
    // declared its own contract.
    for (const ext of vscode.extensions.all) {
      if (declared.has(ext.id)) continue;
      const shims = shimCatalog[ext.id];
      if (!shims) continue;
      for (const s of shims) push(s);
    }

    this.cache = checks;
    return checks;
  }

  /** Resolves a single check by id and executes it. */
  async runOne(id: string): Promise<DependencyStatus> {
    const checks = this.cache ?? (await this.collect());
    const found = checks.find(c => c.id === id);
    if (!found) {
      return { state: 'unknown', detail: `No dependency check registered with id "${id}".` };
    }
    return this.runners.run(found.check);
  }

  /** Runs every registered check. Returns a map keyed by check id. */
  async runAll(): Promise<Map<string, DependencyStatus>> {
    const checks = await this.collect();
    const results = new Map<string, DependencyStatus>();
    await Promise.all(
      checks.map(async c => {
        results.set(c.id, await this.runners.run(c.check));
      })
    );
    return results;
  }
}
