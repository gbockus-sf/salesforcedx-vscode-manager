import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { EXTENSION_ID, SALESFORCE_PUBLISHER } from '../constants';
import { compare as compareVersions } from '../dependencies/versionCompare';
import { getLocalization, LocalizationKeys } from '../localization';
import type { CodeCliService } from './codeCliService';
import type { SettingsService } from './settingsService';
import type { Logger } from '../util/logger';

export interface InstallOutcome {
  source: 'vsix' | 'marketplace';
  exitCode: number;
  stderr?: string;
}

export type ToggleOutcome = 'ok' | 'manual-required';

/**
 * Routes through VsixInstaller in Phase 8. Until then, install() always
 * installs from the marketplace.
 */
export interface VsixInstallerLike {
  tryInstall(extensionId: string): Promise<'vsix' | 'marketplace' | 'skipped'>;
}

/**
 * Optional marketplace-version probe. Kept as an interface so tests (and the
 * `updateCheck = never` setting) can plug in a no-op.
 */
export interface MarketplaceVersionProbe {
  getLatestVersion(extensionId: string): Promise<string | undefined>;
  clearCache(): void;
  /**
   * Distinguishes "id doesn't exist on the marketplace" from "probe
   * unavailable (offline, etc.)". Used by `install()` to avoid waste on
   * known-bad ids. Optional for backward compat with existing mocks.
   */
  resolveExistence?(extensionId: string): Promise<'found' | 'missing' | 'unknown'>;
}

export interface NodeVersionInfo {
  installedVersion: string | undefined;
  latestVersion: string | undefined;
  updateAvailable: boolean;
  source: 'vsix' | 'marketplace' | 'unknown';
}

/**
 * Static snapshot of the VSCode extension-dependency graph for currently
 * installed extensions. Sourced from `ext.packageJSON.extensionDependencies`
 * and `.extensionPack` — no activation, no network.
 */
export interface DependencyGraphNode {
  id: string;
  dependsOn: string[];
  packMembers: string[];
}
export type DependencyGraph = Map<string, DependencyGraphNode>;

/**
 * VSCode treats `publisher.name` case-insensitively (marketplace lookups,
 * `getExtension`, and the `code` CLI all normalize), but our dependency
 * graph used to key on whatever casing each manifest happened to declare.
 * That bit us when `salesforcedx-vscode-agents` shipped with
 * `"publisher": "Salesforce"` while every pack's `extensionPack` array
 * referenced it as `salesforce.salesforcedx-vscode-agents` — our BFS
 * treated them as two distinct ids and tried to uninstall the same
 * extension twice. One source of truth: every graph-side id gets lowered
 * at the boundary.
 */
const normalizeId = (id: string): string => id.toLowerCase();
const normalizeIds = (ids: readonly string[]): string[] => ids.map(normalizeId);

export class ExtensionService {
  private vsixInstaller: VsixInstallerLike | undefined;
  private marketplaceProbe: MarketplaceVersionProbe | undefined;
  private getInstallSource: ((id: string) => 'vsix' | 'marketplace' | 'unknown') | undefined;
  private getCatalogDisplayName: ((id: string) => string | undefined) | undefined;
  private cliVersionCache: Map<string, string> | undefined;
  private loggedCommandList = false;
  private lockedIdsCache: ReadonlySet<string> | undefined;

  constructor(
    private readonly settings: SettingsService,
    private readonly codeCli: CodeCliService,
    private readonly logger: Logger
  ) {}

  setVsixInstaller(installer: VsixInstallerLike): void {
    this.vsixInstaller = installer;
  }

  setMarketplaceProbe(probe: MarketplaceVersionProbe | undefined): void {
    this.marketplaceProbe = probe;
  }

  setInstallSourceLookup(fn: (id: string) => 'vsix' | 'marketplace' | 'unknown'): void {
    this.getInstallSource = fn;
  }

  setCatalogDisplayNameLookup(fn: (id: string) => string | undefined): void {
    this.getCatalogDisplayName = fn;
  }

  /**
   * Single lookup for user-facing copy — tree labels, notification bodies,
   * quick-pick items. Resolves via `getDisplayName(id)` first (runtime or
   * on-disk manifest), then the marketplace-catalog snapshot when one is
   * wired, and finally falls back to the raw id so the caller always gets
   * something renderable. Log messages and internal identifiers keep the
   * raw id — this helper is for anything a human reads.
   */
  label(id: string): string {
    return this.getDisplayName(id) ?? this.getCatalogDisplayName?.(id) ?? id;
  }

  /**
   * Returns true when `id` is a runtime prerequisite of the manager
   * extension itself — its manifest `extensionDependencies` BFS-expanded
   * through the installed extensions' own manifests. VSCode force-installs
   * these and refuses to uninstall them while we're installed; we mirror
   * the same block in our own UI so users aren't shown buttons that
   * would fight VSCode's guarantees.
   *
   * The set is read once per session and memoized — reloading picks up
   * any changes to our own manifest.
   */
  isLocked(id: string): boolean {
    if (!this.lockedIdsCache) this.lockedIdsCache = this.computeLockedIds();
    return this.lockedIdsCache.has(normalizeId(id));
  }

  /** Exposed so tests (and the tree) can enumerate locked ids. */
  lockedIds(): ReadonlySet<string> {
    if (!this.lockedIdsCache) this.lockedIdsCache = this.computeLockedIds();
    return this.lockedIdsCache;
  }

  private computeLockedIds(): ReadonlySet<string> {
    const locked = new Set<string>();
    const frontier = this.readOwnExtensionDependencies();
    while (frontier.length > 0) {
      const next = frontier.pop()!;
      if (locked.has(next)) continue;
      locked.add(next);
      const manifest = vscode.extensions.getExtension(next)?.packageJSON as
        | { extensionDependencies?: unknown }
        | undefined;
      const deps = Array.isArray(manifest?.extensionDependencies)
        ? normalizeIds(
            (manifest!.extensionDependencies as unknown[]).filter(
              (v): v is string => typeof v === 'string'
            )
          )
        : [];
      for (const dep of deps) {
        if (!locked.has(dep)) frontier.push(dep);
      }
    }
    return locked;
  }

  private readOwnExtensionDependencies(): string[] {
    const self = vscode.extensions.getExtension(EXTENSION_ID);
    const deps = (self?.packageJSON as { extensionDependencies?: unknown } | undefined)
      ?.extensionDependencies;
    if (!Array.isArray(deps)) return [];
    return normalizeIds(deps.filter((v): v is string => typeof v === 'string'));
  }

  managed(): vscode.Extension<unknown>[] {
    // Publisher comparison is case-insensitive because VSCode and the
    // marketplace treat publisher.name ids that way. Historically
    // `salesforcedx-vscode-agents` shipped with `"publisher": "Salesforce"`
    // (capital S) while every pack referenced it as lowercase — without
    // normalization, agents was silently skipped from managed(), which
    // then bricked the disable-cascade because everything agents depends
    // on looked "blocked by an outside-candidate extension".
    const thirdParty = new Set(this.settings.getThirdPartyExtensionIds().map(normalizeId));
    const publisher = normalizeId(SALESFORCE_PUBLISHER);
    const selfId = normalizeId(EXTENSION_ID);
    return vscode.extensions.all.filter(ext => {
      const id = normalizeId(ext.id);
      if (id === selfId) return false; // never toggle self
      const extPublisher = id.split('.')[0];
      return extPublisher === publisher || thirdParty.has(id);
    });
  }

  isInstalled(id: string): boolean {
    // `vscode.extensions.getExtension` uses a snapshot captured at window
    // startup and does NOT reflect mid-session `code --uninstall-extension`
    // calls. Result: after uninstalling an extension from our own UI, the
    // runtime lookup keeps returning truthy for the rest of the session
    // and the tree re-renders it as installed.
    //
    // Disk is the authoritative answer mid-session. We combine the two:
    //   - If the runtime lookup AND the disk match both agree (either
    //     both find it or both don't), return that.
    //   - If they disagree (almost always disk=false, runtime=true,
    //     meaning the extension was uninstalled mid-session), trust disk.
    //   - If the disk scan can't run (no extensions directory we can
    //     find), trust the runtime lookup.
    const runtime = vscode.extensions.getExtension(id) !== undefined;
    const disk = this.readInstalledOnDiskAnswer(id);
    if (disk === undefined) return runtime;
    return disk;
  }

  /**
   * Returns true/false when the user's VSCode extensions directory can be
   * scanned (the authoritative answer mid-session), or `undefined` when
   * we can't get a reliable disk answer so callers fall back to the
   * runtime snapshot. Returns `undefined` in these cases:
   *   - Remote dev (Remote-SSH / WSL / Codespaces): extensions live on
   *     the remote host under `~/.vscode-server/extensions`, which we
   *     can't see from the local filesystem. The remote extension host
   *     provides authoritative state via `vscode.extensions` anyway.
   *   - No extensions directory we can locate (unit tests with a stubbed
   *     VSCODE_EXTENSIONS path, exotic installs, etc.).
   *   - The readdir call throws (permissions, race with VSCode's own
   *     cleanup, etc.).
   * When disk can answer, it also honors VSCode's `.obsolete` tombstone
   * file so directories that are pending-removal are treated as
   * uninstalled.
   */
  private readInstalledOnDiskAnswer(id: string): boolean | undefined {
    // Remote dev: skip disk entirely. vscode.extensions.all reflects
    // the remote host's state authoritatively, so the runtime snapshot
    // is actually right in this mode.
    if (vscode.env.remoteName) return undefined;
    const dir = resolveExtensionsDir();
    if (!dir) return undefined;
    try {
      const prefix = `${id.toLowerCase()}-`;
      const obsolete = readObsoleteTombstones(dir);
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.toLowerCase().startsWith(prefix)) continue;
        if (obsolete.has(entry)) continue; // tombstoned — treat as uninstalled
        return true;
      }
      return false;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolves the human-readable display name for an extension id. Priority:
   *   1. Runtime `ext.packageJSON.displayName` (installed + active extensions).
   *   2. Manifest read directly from `~/.vscode/extensions/` (catches
   *      mid-session installs that `extensions.all` hasn't refreshed yet).
   *   3. `undefined` — caller falls back to the raw id.
   *
   * This is the single source of truth the tree uses so raw ids like
   * `salesforce.salesforcedx-einstein-gpt` render as "Agentforce Vibes"
   * wherever we have the metadata.
   */
  getDisplayName(id: string): string | undefined {
    const runtime = vscode.extensions.getExtension(id)?.packageJSON as
      | { displayName?: unknown }
      | undefined;
    if (typeof runtime?.displayName === 'string' && runtime.displayName.length > 0) {
      return runtime.displayName;
    }
    const onDisk = readInstalledManifestFromDisk(id) as
      | { displayName?: unknown }
      | undefined;
    if (typeof onDisk?.displayName === 'string' && onDisk.displayName.length > 0) {
      return onDisk.displayName;
    }
    return undefined;
  }

  isEnabled(id: string): boolean {
    // Under the codeCli backend we uninstall-to-disable, so "enabled" and
    // "installed" are effectively the same signal — and `isInstalled`
    // already does the disk-authoritative check that masks
    // `vscode.extensions.getExtension`'s stale-snapshot behavior.
    return this.isInstalled(id);
  }

  readManifest<T = unknown>(id: string): T | undefined {
    return vscode.extensions.getExtension(id)?.packageJSON as T | undefined;
  }

  /**
   * Snapshot of `extensionDependencies` + `extensionPack` for every currently
   * installed extension. Callers can use this to order uninstalls
   * topologically, auto-include transitive deps on enable, and refuse to
   * disable an extension that another installed extension still depends on.
   */
  getDependencyGraph(): DependencyGraph {
    const graph: DependencyGraph = new Map();
    for (const ext of vscode.extensions.all) {
      const pkg = ext.packageJSON as
        | { extensionDependencies?: unknown; extensionPack?: unknown }
        | undefined;
      const dependsOn = Array.isArray(pkg?.extensionDependencies)
        ? normalizeIds(
            (pkg!.extensionDependencies as unknown[]).filter((v): v is string => typeof v === 'string')
          )
        : [];
      const packMembers = Array.isArray(pkg?.extensionPack)
        ? normalizeIds(
            (pkg!.extensionPack as unknown[]).filter((v): v is string => typeof v === 'string')
          )
        : [];
      const id = normalizeId(ext.id);
      graph.set(id, { id, dependsOn, packMembers });
    }
    // VSCode's `extensions.all` is a snapshot of the startup state — it
    // doesn't pick up extensions installed later in this session until a
    // reload. Read those ids' manifests directly from the
    // ~/.vscode/extensions install directory so the graph reflects
    // what's actually on disk.
    this.augmentGraphFromDisk(graph, [...this.getDiskInstalledIds()]);
    return graph;
  }

  /**
   * Enriches `graph` in place with extension-dependency info for ids that
   * VSCode's runtime `extensions.all` API doesn't yet know about (e.g.,
   * extensions installed after the window started). Reads each candidate's
   * `package.json` directly from `~/.vscode/extensions/<id>-<version>/`.
   * Silent no-op on any I/O failure — the apply flow must not crash when
   * one manifest is missing or malformed.
   */
  augmentGraphFromDisk(graph: DependencyGraph, ids: readonly string[]): void {
    for (const raw of ids) {
      const id = normalizeId(raw);
      if (graph.has(id)) continue; // live runtime wins over disk
      const manifest = readInstalledManifestFromDisk(id);
      if (!manifest) continue;
      const dependsOn = Array.isArray(manifest.extensionDependencies)
        ? normalizeIds(
            (manifest.extensionDependencies as unknown[]).filter(
              (v): v is string => typeof v === 'string'
            )
          )
        : [];
      const packMembers = Array.isArray(manifest.extensionPack)
        ? normalizeIds(
            (manifest.extensionPack as unknown[]).filter((v): v is string => typeof v === 'string')
          )
        : [];
      graph.set(id, { id, dependsOn, packMembers });
    }
  }

  /**
   * Returns every extension id installed under the user's VSCode extensions
   * directory, scanned live from disk. Includes extensions installed after
   * window startup that `vscode.extensions.all` doesn't yet know about.
   */
  getDiskInstalledIds(): Set<string> {
    const dir = resolveExtensionsDir();
    const out = new Set<string>();
    if (!dir) return out;
    try {
      for (const entry of fs.readdirSync(dir)) {
        const parsed = parseExtensionDirName(entry);
        if (parsed) out.add(normalizeId(parsed));
      }
    } catch {
      // extensions dir missing / unreadable — graceful no-op.
    }
    return out;
  }

  /**
   * Reverse direction of `transitiveDependencies`: the set of ids that
   * depend on any of `roots` — directly or transitively. Used by the
   * single-extension uninstall command to enumerate the cascade VSCode
   * would otherwise refuse mid-way with "Cannot uninstall, X depends on
   * this". Does NOT include the roots themselves.
   *
   * Only `extensionDependencies` counts as a reverse edge here, NOT
   * `extensionPack` membership. Packs are convenience bundles — a pack
   * *lists* its members but doesn't *depend* on them. VSCode itself
   * lets you uninstall pack members without removing the pack; doing
   * the same preserves the user's intent ("I want this one extension
   * gone, not the bundle") and avoids the "required by Salesforce
   * Extension Pack" false-positive in the cascade-confirm modal.
   */
  transitiveDependents(roots: readonly string[], graph: DependencyGraph): Set<string> {
    const normalizedRoots = normalizeIds(roots);
    const out = new Set<string>();
    const stack = [...normalizedRoots];
    const rootSet = new Set(normalizedRoots);
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const [otherId, node] of graph) {
        if (out.has(otherId)) continue;
        if (rootSet.has(otherId)) continue; // roots themselves aren't dependents-of-themselves
        if (node.dependsOn.includes(id)) {
          out.add(otherId);
          stack.push(otherId);
        }
      }
    }
    return out;
  }

  /**
   * Returns the set of ids that `roots` transitively depend on (via
   * `extensionDependencies`). Does NOT include the roots themselves. Stops at
   * ids missing from the provided graph (e.g., not installed).
   */
  transitiveDependencies(roots: readonly string[], graph: DependencyGraph): Set<string> {
    const out = new Set<string>();
    const stack = normalizeIds(roots);
    while (stack.length > 0) {
      const id = stack.pop()!;
      const node = graph.get(id);
      if (!node) continue;
      for (const dep of node.dependsOn) {
        if (out.has(dep)) continue;
        out.add(dep);
        stack.push(dep);
      }
    }
    return out;
  }

  /**
   * Returns the set of installed extension ids that any extension *outside*
   * `candidateDisableSet` depends on. Callers use this to refuse a disable
   * when a currently-enabled extension would break without it. Iterates to a
   * fixed point — removing one extension can free up another to be disabled.
   */
  computeBlockedByDependents(
    candidateDisableSet: Set<string>,
    graph: DependencyGraph
  ): Map<string, string[]> {
    const normalizedCandidates = new Set<string>(
      [...candidateDisableSet].map(normalizeId)
    );
    const blocked = new Map<string, string[]>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id] of graph) {
        if (!normalizedCandidates.has(id)) continue;
        if (blocked.has(id)) continue;
        const blockers: string[] = [];
        for (const [depId, depNode] of graph) {
          // A candidate that isn't blocked can still be disabled, so
          // it's *not* a blocker — its dependencies can go with it.
          if (normalizedCandidates.has(depId) && !blocked.has(depId)) continue;
          // Packs list their members but don't runtime-depend on them;
          // only extensionDependencies is a real block. See
          // transitiveDependents for the full rationale.
          if (depNode.dependsOn.includes(id)) {
            blockers.push(depId);
          }
        }
        if (blockers.length > 0) {
          blocked.set(id, blockers);
          changed = true;
        }
      }
    }
    return blocked;
  }

  /**
   * Orders a set of ids for uninstall so dependents come off before their
   * dependencies and pack members come off before the pack. Any id missing
   * from `graph` is appended at the end (best-effort when graph info is
   * incomplete).
   */
  topologicalUninstallOrder(ids: readonly string[], graph: DependencyGraph): string[] {
    const normalized = normalizeIds(ids);
    const idSet = new Set(normalized);
    const visited = new Set<string>();
    const out: string[] = [];
    const visit = (id: string): void => {
      if (visited.has(id) || !idSet.has(id)) return;
      visited.add(id);
      // Visit everything that DEPENDS ON `id` first — they must come off before `id` does.
      for (const [otherId, node] of graph) {
        if (!idSet.has(otherId)) continue;
        if (node.dependsOn.includes(id) || node.packMembers.includes(id)) {
          visit(otherId);
        }
      }
      out.push(id);
    };
    for (const id of normalized) visit(id);
    for (const id of normalized) if (!visited.has(id)) out.push(id);
    return out;
  }

  /**
   * Make sure an extension is installed and active in the current window.
   * Under the codeCli backend this means `code --install-extension <id>`
   * (a no-op if already installed and up to date).
   */
  async enable(id: string): Promise<ToggleOutcome> {
    if (this.settings.getBackend() !== 'codeCli') {
      this.logger.warn(`enable(${id}) requested but backend is not codeCli; skipping.`);
      return 'manual-required';
    }
    if (this.isInstalled(id)) {
      this.logger.info(`enable(${id}): already installed; nothing to do.`);
      return 'ok';
    }
    const install = await this.install(id);
    if (install.exitCode !== 0) {
      this.logger.warn(`enable(${id}): install exit ${install.exitCode}; manual required.`);
      return 'manual-required';
    }
    return 'ok';
  }

  /**
   * Make sure an extension is not active in the current window. Under the
   * codeCli backend this means `code --uninstall-extension <id>`.
   */
  async disable(id: string): Promise<ToggleOutcome> {
    if (this.settings.getBackend() !== 'codeCli') {
      this.logger.warn(`disable(${id}) requested but backend is not codeCli; skipping.`);
      return 'manual-required';
    }
    if (!this.isInstalled(id)) {
      this.logger.info(`disable(${id}): not installed; nothing to do.`);
      return 'ok';
    }
    const { exitCode, stderr } = await this.codeCli.uninstallExtension(id);
    if (exitCode !== 0) {
      this.logger.warn(`disable(${id}): uninstall exit ${exitCode} stderr=${stderr ?? ''}`);
      return 'manual-required';
    }
    this.logger.info(`disable(${id}): uninstalled via code CLI.`);
    return 'ok';
  }

  async showManualToggleHint(ids: string[], action: 'Enable' | 'Disable'): Promise<void> {
    if (ids.length === 0) return;
    await this.openExtensionsViewFor(ids, action);
  }

  async logAvailableExtensionCommands(): Promise<void> {
    if (this.loggedCommandList) return;
    const all = await vscode.commands.getCommands(true);
    const ours = all.filter(c => c.includes('extension')).sort();
    this.logger.info(`Available extension-related commands (${ours.length}):\n  ${ours.join('\n  ')}`);
    this.loggedCommandList = true;
  }

  async install(id: string, options: { force?: boolean } = {}): Promise<InstallOutcome> {
    if (this.vsixInstaller) {
      const result = await this.vsixInstaller.tryInstall(id);
      if (result === 'vsix') {
        return { source: 'vsix', exitCode: 0 };
      }
      if (result === 'skipped') {
        // A local vsix matched but failed — don't silently swap to marketplace.
        return { source: 'vsix', exitCode: 1, stderr: 'local vsix install failed' };
      }
    }
    // Skip a marketplace install when the probe can confirm the id doesn't
    // exist. An 'unknown' result (offline, timeout) falls through so we stay
    // safe when the probe is unavailable.
    if (this.marketplaceProbe?.resolveExistence) {
      const existence = await this.marketplaceProbe.resolveExistence(id);
      if (existence === 'missing') {
        this.logger.warn(`install(${id}): skipped — id is not published on the marketplace.`);
        return {
          source: 'marketplace',
          exitCode: 2,
          stderr: 'not published on the marketplace'
        };
      }
    }
    const { exitCode, stderr } = options.force
      ? await this.codeCli.installExtension(id, true)
      : await this.codeCli.installExtension(id);
    if (exitCode !== 0) {
      this.logger.error(`Install failed for ${id}`, stderr);
    } else if (this.vsixInstaller && 'recordMarketplaceInstall' in this.vsixInstaller) {
      await (this.vsixInstaller as unknown as {
        recordMarketplaceInstall: (id: string) => Promise<void>;
      }).recordMarketplaceInstall(id);
    }
    return { source: 'marketplace', exitCode, stderr };
  }

  async uninstall(id: string): Promise<{ exitCode: number; stderr?: string }> {
    const { exitCode, stderr } = await this.codeCli.uninstallExtension(id);
    // "Extension X is not installed" means there's nothing to do — the
    // user's goal (make X go away) is already satisfied. Report it as a
    // success so cascade callers don't flag it as a partial failure and
    // trip the "Some uninstalls failed" error toast. Happens legitimately
    // after a successful uninstall earlier in this session (runtime
    // snapshot lagged) or when the cascade re-enters an id that a
    // previous leg already removed.
    if (exitCode !== 0 && isNotInstalledError(stderr)) {
      this.logger.info(`uninstall(${id}): already gone; treated as a no-op.`);
      return { exitCode: 0, stderr };
    }
    if (exitCode !== 0) {
      this.logger.error(`Uninstall failed for ${id}`, stderr);
    }
    return { exitCode, stderr };
  }

  private async openExtensionsViewFor(ids: string[], action: 'Enable' | 'Disable'): Promise<void> {
    const query = ids.map(i => `@installed ${i}`).join(' ');
    await vscode.commands.executeCommand('workbench.extensions.search', query);
    await vscode.window.showInformationMessage(
      getLocalization(LocalizationKeys.manualToggleHint, action, ids.length)
    );
  }

  /**
   * Returns the currently installed version of `id`, read statically from
   * `vscode.extensions.getExtension(id).packageJSON.version`. Does not
   * activate the extension.
   */
  getInstalledVersion(id: string): string | undefined {
    const ext = vscode.extensions.getExtension(id);
    const version = (ext?.packageJSON as { version?: unknown } | undefined)?.version;
    return typeof version === 'string' ? version : undefined;
  }

  /**
   * Runs `code --list-extensions --show-versions` once per session and
   * caches the parsed `id -> version` map. Subsequent calls are no-ops
   * until `clearCliVersionCache()` is called (e.g. after an install).
   * Silently no-ops when the CLI invocation fails.
   */
  async refreshInstalledCliVersions(): Promise<void> {
    if (this.cliVersionCache) return;
    try {
      const { exitCode, stdout } = await this.codeCli.listInstalledWithVersions();
      if (exitCode !== 0) {
        this.cliVersionCache = new Map();
        return;
      }
      this.cliVersionCache = parseCliVersions(stdout);
    } catch (err) {
      this.logger.warn(`list-extensions failed: ${err instanceof Error ? err.message : String(err)}`);
      this.cliVersionCache = new Map();
    }
  }

  clearCliVersionCache(): void {
    this.cliVersionCache = undefined;
  }

  /** Cached `code --list-extensions --show-versions` lookup. */
  getCliInstalledVersion(id: string): string | undefined {
    return this.cliVersionCache?.get(id);
  }

  /**
   * Aggregates installed version, marketplace version (when probe is wired
   * and returns a value), update-available flag, and install provenance for
   * a single extension id. Used by the Groups tree to render per-node state
   * without doing its own network calls.
   */
  async getNodeVersionInfo(id: string): Promise<NodeVersionInfo> {
    const installedVersion = this.getInstalledVersion(id) ?? this.getCliInstalledVersion(id);
    let latestVersion: string | undefined;
    if (this.marketplaceProbe && this.settings.getUpdateCheck() !== 'never') {
      try {
        latestVersion = await this.marketplaceProbe.getLatestVersion(id);
      } catch {
        latestVersion = undefined;
      }
    }
    const updateAvailable =
      !!installedVersion && !!latestVersion && compareVersions(installedVersion, latestVersion) < 0;
    const source = this.getInstallSource?.(id) ?? 'unknown';
    return { installedVersion, latestVersion, updateAvailable, source };
  }
}

/**
 * Resolves the VSCode user-extensions directory. Order of preference:
 *   1. `VSCODE_EXTENSIONS` env var — when set, we honor it as the
 *      authoritative answer even if the path doesn't exist on disk.
 *      (A missing path means the caller explicitly told us "don't look
 *      elsewhere"; unit tests rely on this to suppress disk scans.)
 *   2. The parent of any known-installed extension's `extensionPath`
 *      — this is the most reliable cross-OS signal because VSCode
 *      itself populates `extensionPath` wherever it actually reads
 *      extensions from. Covers:
 *        - macOS / Linux default ~/.vscode/extensions
 *        - Windows default %USERPROFILE%/.vscode/extensions
 *        - Portable mode (<install-dir>/data/extensions)
 *        - Custom `--extensions-dir` launches
 *        - Insiders (~/.vscode-insiders/extensions)
 *      We filter out user-scope extensions first (any non-built-in
 *      extension under the extensions folder), because built-ins live
 *      under the VSCode install root which is the wrong directory.
 *   3. Fall back to the historical `~/.vscode-insiders/extensions` /
 *      `~/.vscode/extensions` guess. Exists as a last-ditch on edge
 *      cases where no user-installed extensions are present yet.
 * Returns `undefined` when none of these resolve.
 */
const resolveExtensionsDir = (): string | undefined => {
  const envDir = process.env.VSCODE_EXTENSIONS;
  if (envDir) return envDir;
  // Primary: derive from any non-built-in extension's path. VSCode's
  // `isBuiltin` flag (not always typed in older @types/vscode) and the
  // path pattern (extensions under appRoot are built-ins) are both
  // signals; the path check is cheaper and sufficient.
  const appRoot = vscode.env.appRoot;
  for (const ext of vscode.extensions.all) {
    const extPath = (ext as unknown as { extensionPath?: string }).extensionPath;
    if (!extPath) continue;
    // Skip built-in extensions — those live under VSCode's install root,
    // not the user-extensions directory.
    if (appRoot && extPath.startsWith(appRoot)) continue;
    const parent = path.dirname(extPath);
    try {
      if (fs.existsSync(parent)) return parent;
    } catch {
      // continue
    }
  }
  // Fallback: the historical guess. Reached on fresh installs with no
  // user extensions, or hosts where `extensionPath` is unavailable.
  const home = os.homedir();
  const candidates = [
    path.join(home, '.vscode-insiders', 'extensions'),
    path.join(home, '.vscode', 'extensions')
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir;
    } catch {
      // continue
    }
  }
  return undefined;
};

/**
 * Matches the `code` CLI's "Extension X is not installed." stderr.
 * Treated as a non-error because the caller's intent (make X go away)
 * is already satisfied. Case-insensitive match keeps us robust if the
 * CLI copy ever shifts casing.
 */
const isNotInstalledError = (stderr: string | undefined): boolean => {
  if (!stderr) return false;
  return /is not installed/i.test(stderr);
};

/**
 * VSCode writes a `.obsolete` JSON file in the extensions directory
 * mapping `<publisher>.<name>-<version>` entries to `true` when an
 * extension is uninstalled but its directory hasn't been cleaned up
 * yet (cleanup happens at next window start). Our disk scan has to
 * respect this or we'll false-positive recently-uninstalled extensions
 * as installed — same net bug as trusting the stale runtime snapshot.
 * Returns an empty set if the file is missing or unparseable.
 */
const readObsoleteTombstones = (extensionsDir: string): Set<string> => {
  const out = new Set<string>();
  try {
    const raw = fs.readFileSync(path.join(extensionsDir, '.obsolete'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (value === true) out.add(key);
    }
  } catch {
    // File missing or malformed — no tombstones to apply.
  }
  return out;
};

/**
 * Parses a directory name under `~/.vscode/extensions/` back into its
 * `publisher.name` extension id. VSCode uses `<publisher>.<name>-<version>`;
 * there may be additional suffixes like a universal-platform marker.
 * Returns `undefined` for non-extension entries (.obsolete, .lock, etc.).
 */
const parseExtensionDirName = (entry: string): string | undefined => {
  if (entry.startsWith('.')) return undefined;
  const match = entry.match(/^([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)-\d/i);
  if (!match) return undefined;
  return `${match[1]}.${match[2]}`;
};

/**
 * Reads the `package.json` of an extension installed on disk. Only the
 * fields the manager cares about (`extensionDependencies`,
 * `extensionPack`) are typed; the full manifest is returned as an
 * unknown record so callers can access other fields when needed.
 * Returns `undefined` if the directory can't be found or the manifest
 * can't be parsed.
 */
interface DiskManifest {
  extensionDependencies?: unknown;
  extensionPack?: unknown;
  displayName?: unknown;
}

const readInstalledManifestFromDisk = (
  extensionId: string
): DiskManifest | undefined => {
  const dir = resolveExtensionsDir();
  if (!dir) return undefined;
  let match: string | undefined;
  try {
    const prefix = `${extensionId.toLowerCase()}-`;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.toLowerCase().startsWith(prefix)) {
        match = entry;
        break;
      }
    }
  } catch {
    return undefined;
  }
  if (!match) return undefined;
  try {
    const raw = fs.readFileSync(path.join(dir, match, 'package.json'), 'utf8');
    return JSON.parse(raw) as DiskManifest;
  } catch {
    return undefined;
  }
};

/**
 * Parses `publisher.name@version` lines emitted by
 * `code --list-extensions --show-versions`. Exported for unit testing.
 */
export const parseCliVersions = (stdout: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const at = line.lastIndexOf('@');
    if (at <= 0) continue;
    const id = line.slice(0, at).trim();
    const version = line.slice(at + 1).trim();
    if (id && version) out.set(id, version);
  }
  return out;
};
