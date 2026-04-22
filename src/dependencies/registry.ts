import * as vscode from 'vscode';
import { DependencyRunners, expandPath } from './runners';
import { shimCatalog } from './shimCatalog';
import type { CheckDefinition, DependencyCheck, DependencyStatus } from './types';

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

/**
 * Stable logical fingerprint for a `CheckDefinition`. Two checks with equal
 * fingerprints represent the same underlying prerequisite even if they were
 * declared under different ids by different extensions — the registry folds
 * them into one row and accumulates owners. See PLAN.md §9 "Dedupe the
 * Dependencies list by logical check, not just by id.".
 *
 * Intentional rules:
 * - `exec`: command + sorted args + minVersion (ignores versionRegex — two
 *   declarations that differ only in how they parse the version are still the
 *   same logical check).
 * - `env`: env var only; the optional fallback is NOT part of the fingerprint
 *   so two declarations of e.g. `JAVA_HOME` with different fallbacks still
 *   merge.
 * - `file`: canonicalized path via `expandPath`.
 * - `nodeVersion`: minVersion.
 * - `extensionInstalled`: extensionId.
 */
const fingerprint = (check: CheckDefinition): string => {
  switch (check.type) {
    case 'exec': {
      const args = [...(check.args ?? [])].sort().join(',');
      return `exec:${check.command}:${args}:${check.minVersion ?? ''}`;
    }
    case 'env':
      return `env:${check.env}`;
    case 'file':
      return `file:${expandPath(check.path)}`;
    case 'nodeVersion':
      return `nodeVersion:${check.minVersion}`;
    case 'extensionInstalled':
      return `extensionInstalled:${check.extensionId}`;
    default: {
      // Exhaustiveness guard.
      const exhaustive: never = check;
      return `unknown:${JSON.stringify(exhaustive)}`;
    }
  }
};

export class DependencyRegistry {
  private cache: DependencyCheck[] | undefined;

  constructor(private readonly runners: DependencyRunners) {}

  /**
   * Scans every installed extension's `packageJSON.salesforceDependencies`
   * (read statically — no activation) and merges in shim catalog entries for
   * extensions that have not declared their own contract. Always prepends the
   * top-level built-in checks (sf CLI, git, node).
   *
   * Dedupes by logical fingerprint (see `fingerprint`): when multiple
   * declarations point at the same underlying prerequisite they are folded
   * into a single row whose metadata comes from the earliest-precedence
   * source. Precedence: built-ins > shim catalog > manifest declarations (in
   * `vscode.extensions.all` iteration order). Owners from every contributing
   * declaration are accumulated into `ownerExtensionIds`.
   */
  async collect(): Promise<DependencyCheck[]> {
    const order: string[] = [];
    const byFingerprint = new Map<string, DependencyCheck>();

    const merge = (incoming: DependencyCheck): void => {
      const key = fingerprint(incoming.check);
      const incomingOwners = incoming.ownerExtensionIds
        ? [...incoming.ownerExtensionIds]
        : incoming.ownerExtensionId
          ? [incoming.ownerExtensionId]
          : [];
      const existing = byFingerprint.get(key);
      if (!existing) {
        const merged: DependencyCheck = {
          ...incoming,
          ownerExtensionIds: incomingOwners,
          ownerExtensionId: incomingOwners[0] ?? incoming.ownerExtensionId
        };
        byFingerprint.set(key, merged);
        order.push(key);
        return;
      }
      // Keep existing (earliest-precedence) metadata; accumulate owners.
      const seen = new Set(existing.ownerExtensionIds ?? []);
      for (const owner of incomingOwners) {
        if (!seen.has(owner)) {
          seen.add(owner);
          existing.ownerExtensionIds = [...(existing.ownerExtensionIds ?? []), owner];
        }
      }
      if (!existing.ownerExtensionId && existing.ownerExtensionIds && existing.ownerExtensionIds.length > 0) {
        existing.ownerExtensionId = existing.ownerExtensionIds[0];
      }
    };

    // 1. Built-ins (highest precedence).
    for (const b of BUILT_IN_CHECKS) merge(b);

    // 2. Manifest declarations, in extension iteration order. We walk the
    //    manifests first so we know which ext ids opted into the contract
    //    and can skip their shim entries below. Within the same precedence
    //    tier, the first-seen declaration wins for display metadata.
    const declared = new Set<string>();
    for (const ext of vscode.extensions.all) {
      const pkg = ext.packageJSON as ManifestWithDeps | undefined;
      const deps = pkg?.salesforceDependencies;
      if (Array.isArray(deps) && deps.length > 0) {
        declared.add(ext.id);
      }
    }

    // 3. Shim catalog (second-highest precedence) — only for extensions that
    //    did NOT declare their own contract.
    for (const ext of vscode.extensions.all) {
      if (declared.has(ext.id)) continue;
      const shims = shimCatalog[ext.id];
      if (!shims) continue;
      for (const s of shims) merge(s);
    }

    // 4. Manifest declarations last (lowest precedence of the three), so a
    //    built-in or shim with the same fingerprint keeps its id/label but
    //    the manifest's owner is added to `ownerExtensionIds`.
    for (const ext of vscode.extensions.all) {
      const pkg = ext.packageJSON as ManifestWithDeps | undefined;
      const deps = pkg?.salesforceDependencies;
      if (!Array.isArray(deps) || deps.length === 0) continue;
      for (const raw of deps) {
        merge({
          ...raw,
          category: raw.category ?? 'per-extension',
          ownerExtensionId: raw.ownerExtensionId ?? ext.id
        });
      }
    }

    const checks = order.map(k => byFingerprint.get(k)!);
    for (const c of checks) {
      // Normalize: drop empty ownerExtensionIds for cleanliness on built-ins
      // so serialized snapshots / consumers don't see a noisy `[]`.
      if (c.ownerExtensionIds && c.ownerExtensionIds.length === 0) {
        delete c.ownerExtensionIds;
      }
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
