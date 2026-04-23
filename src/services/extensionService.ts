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

export class ExtensionService {
  private vsixInstaller: VsixInstallerLike | undefined;
  private marketplaceProbe: MarketplaceVersionProbe | undefined;
  private getInstallSource: ((id: string) => 'vsix' | 'marketplace' | 'unknown') | undefined;
  private cliVersionCache: Map<string, string> | undefined;
  private loggedCommandList = false;

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

  managed(): vscode.Extension<unknown>[] {
    const thirdParty = new Set(this.settings.getThirdPartyExtensionIds());
    return vscode.extensions.all.filter(ext => {
      const id = ext.id;
      if (id === EXTENSION_ID) return false; // never toggle self
      const publisher = id.split('.')[0];
      return publisher === SALESFORCE_PUBLISHER || thirdParty.has(id);
    });
  }

  isInstalled(id: string): boolean {
    return vscode.extensions.getExtension(id) !== undefined;
  }

  isEnabled(id: string): boolean {
    // getExtension only returns extensions that are both installed AND enabled
    // in the current session. Returns undefined for installed-but-disabled.
    return vscode.extensions.getExtension(id) !== undefined;
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
        ? (pkg!.extensionDependencies as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      const packMembers = Array.isArray(pkg?.extensionPack)
        ? (pkg!.extensionPack as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      graph.set(ext.id, { id: ext.id, dependsOn, packMembers });
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
    for (const id of ids) {
      if (graph.has(id)) continue; // live runtime wins over disk
      const manifest = readInstalledManifestFromDisk(id);
      if (!manifest) continue;
      const dependsOn = Array.isArray(manifest.extensionDependencies)
        ? (manifest.extensionDependencies as unknown[]).filter(
            (v): v is string => typeof v === 'string'
          )
        : [];
      const packMembers = Array.isArray(manifest.extensionPack)
        ? (manifest.extensionPack as unknown[]).filter((v): v is string => typeof v === 'string')
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
        if (parsed) out.add(parsed);
      }
    } catch {
      // extensions dir missing / unreadable — graceful no-op.
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
    const stack = [...roots];
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
    const blocked = new Map<string, string[]>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id] of graph) {
        if (!candidateDisableSet.has(id)) continue;
        if (blocked.has(id)) continue;
        const blockers: string[] = [];
        for (const [depId, depNode] of graph) {
          if (candidateDisableSet.has(depId)) continue;
          if (blocked.has(depId)) continue;
          if (depNode.dependsOn.includes(id) || depNode.packMembers.includes(id)) {
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
    const idSet = new Set(ids);
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
    for (const id of ids) visit(id);
    for (const id of ids) if (!visited.has(id)) out.push(id);
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
 *   1. `VSCODE_EXTENSIONS` env var — explicitly set, trust it.
 *   2. `~/.vscode-insiders/extensions` when the running VSCode is Insiders
 *      (detected via `vscode.env.appRoot` path hint).
 *   3. `~/.vscode/extensions` — the stable default.
 * Returns `undefined` when none of these exist.
 */
const resolveExtensionsDir = (): string | undefined => {
  const envDir = process.env.VSCODE_EXTENSIONS;
  if (envDir && fs.existsSync(envDir)) return envDir;
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
const readInstalledManifestFromDisk = (
  extensionId: string
): { extensionDependencies?: unknown; extensionPack?: unknown } | undefined => {
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
    return JSON.parse(raw) as { extensionDependencies?: unknown; extensionPack?: unknown };
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
