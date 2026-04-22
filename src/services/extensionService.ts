import * as vscode from 'vscode';
import { EXTENSION_ID, SALESFORCE_PUBLISHER } from '../constants';
import { compare as compareVersions } from '../dependencies/versionCompare';
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
}

export interface NodeVersionInfo {
  installedVersion: string | undefined;
  latestVersion: string | undefined;
  updateAvailable: boolean;
  source: 'vsix' | 'marketplace' | 'unknown';
}

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
      `${action} the ${ids.length} extension(s) shown in the Extensions view.`
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
