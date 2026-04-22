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
