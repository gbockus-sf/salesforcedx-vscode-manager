import * as vscode from 'vscode';
import { EXTENSION_ID, SALESFORCE_PUBLISHER } from '../constants';
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

export class ExtensionService {
  private vsixInstaller: VsixInstallerLike | undefined;
  private loggedCommandList = false;

  constructor(
    private readonly settings: SettingsService,
    private readonly codeCli: CodeCliService,
    private readonly logger: Logger
  ) {}

  setVsixInstaller(installer: VsixInstallerLike): void {
    this.vsixInstaller = installer;
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

  async install(id: string): Promise<InstallOutcome> {
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
    const { exitCode, stderr } = await this.codeCli.installExtension(id);
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
}
