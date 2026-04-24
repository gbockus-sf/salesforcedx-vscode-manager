import * as vscode from 'vscode';
import type { CodeCliService } from '../services/codeCliService';
import type { WorkspaceStateService, InstallSource } from '../services/workspaceStateService';
import type { Logger } from '../util/logger';
import type { VsixScanner } from './vsixScanner';

export type TryInstallOutcome = 'vsix' | 'marketplace' | 'skipped';

export class VsixInstaller {
  constructor(
    private readonly scanner: VsixScanner,
    private readonly codeCli: CodeCliService,
    private readonly state: WorkspaceStateService,
    private readonly logger: Logger
  ) {}

  /**
   * Try to install `extensionId` from a matching local VSIX. Returns:
   *   'vsix'       — a local vsix was found and installed (--force).
   *   'marketplace'— no matching vsix found; caller should install from marketplace.
   *   'skipped'    — a local vsix was found but install failed; caller should NOT
   *                  silently fall back to marketplace (user intent was local).
   */
  async tryInstall(extensionId: string): Promise<TryInstallOutcome> {
    if (!this.scanner.isConfigured()) return 'marketplace';
    const overrides = this.scanner.scan();
    const match = overrides.get(extensionId);
    if (!match) return 'marketplace';
    if (match.matchedBy === 'prefix') {
      // Make prefix-matched overrides discoverable in the output
      // channel. If the match looks wrong, the user can rename the
      // file to disambiguate.
      this.logger.info(`vsix: matched '${match.filePath}' to '${extensionId}' via prefix.`);
    }
    const { exitCode, stderr } = await this.codeCli.installExtension(match.filePath, true);
    if (exitCode === 0) {
      await this.state.setInstallSource(extensionId, 'vsix');
      this.logger.info(`vsix: installed ${extensionId} from ${match.filePath}`);
      return 'vsix';
    }
    this.logger.warn(`vsix: install failed for ${extensionId} (${match.filePath}) exit=${exitCode} ${stderr ?? ''}`);
    return 'skipped';
  }

  /**
   * Marks an install as coming from the marketplace. Called by ExtensionService
   * after a successful marketplace-path install so the UI can reflect provenance.
   */
  async recordMarketplaceInstall(extensionId: string): Promise<void> {
    await this.state.setInstallSource(extensionId, 'marketplace');
  }

  /**
   * Force-install every VSIX override from the scanner's current
   * snapshot. Idempotent: rows already at the same version AND flagged
   * as vsix-sourced are skipped so steady-state activation is cheap.
   * Caller is responsible for wrapping this in `busy.withBusy` when
   * ids should show a spinner.
   *
   * Returns `{ installed, skipped, failed }` counts so callers can
   * surface a summary when something goes wrong. Success is silent —
   * the tree badge + output channel log are the only feedback.
   */
  async autoInstallAll(): Promise<{
    installed: string[];
    skipped: string[];
    failed: string[];
  }> {
    const installed: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];
    if (!this.scanner.isConfigured()) return { installed, skipped, failed };
    const overrides = this.scanner.scan();
    const sources = this.state.getInstallSources();
    for (const [extensionId, match] of overrides) {
      // Skip when the override is already the provenance and the
      // version on disk matches the file's parsed version. Avoids
      // reinstalling every .vsix on every reload.
      const currentVersion = this.currentInstalledVersion(extensionId);
      if (sources[extensionId] === 'vsix' && currentVersion && currentVersion === match.version) {
        this.logger.info(`vsix: auto-install skipped ${extensionId} — already at v${match.version}.`);
        skipped.push(extensionId);
        continue;
      }
      const { exitCode, stderr } = await this.codeCli.installExtension(match.filePath, true);
      if (exitCode === 0) {
        await this.state.setInstallSource(extensionId, 'vsix');
        this.logger.info(`vsix: auto-installed ${extensionId} from ${match.filePath}`);
        installed.push(extensionId);
      } else {
        failed.push(extensionId);
        this.logger.warn(
          `vsix: auto-install ${extensionId} (${match.filePath}) exit=${exitCode} ${stderr ?? ''}`
        );
      }
    }
    return { installed, skipped, failed };
  }

  /**
   * Best-effort read of the installed version from vscode.extensions
   * so autoInstallAll() can skip no-ops. Intentionally doesn't go to
   * disk — the static runtime snapshot is enough for the "already at
   * the right version" fast path.
   */
  private currentInstalledVersion(extensionId: string): string | undefined {
    const pkg = vscode.extensions.getExtension(extensionId)?.packageJSON as
      | { version?: string }
      | undefined;
    return pkg?.version;
  }

  currentSources(): Record<string, InstallSource> {
    return this.state.getInstallSources();
  }

  vsixOverrides(): Map<string, { version: string; filePath: string }> {
    return this.scanner.scan();
  }

  /**
   * Uninstall every extension currently flagged as vsix-sourced, then
   * reinstall each from the marketplace.
   */
  async clearAllOverrides(): Promise<string[]> {
    const sources = this.state.getInstallSources();
    const vsixIds = Object.entries(sources)
      .filter(([, source]) => source === 'vsix')
      .map(([id]) => id);
    for (const id of vsixIds) {
      const un = await this.codeCli.uninstallExtension(id);
      if (un.exitCode !== 0) {
        this.logger.warn(`vsix: uninstall ${id} failed exit=${un.exitCode} ${un.stderr ?? ''}`);
        continue;
      }
      const mp = await this.codeCli.installExtension(id);
      if (mp.exitCode === 0) {
        await this.state.setInstallSource(id, 'marketplace');
      } else {
        this.logger.warn(`vsix: marketplace reinstall ${id} failed exit=${mp.exitCode} ${mp.stderr ?? ''}`);
        await this.state.setInstallSource(id, undefined);
      }
    }
    return vsixIds;
  }
}
