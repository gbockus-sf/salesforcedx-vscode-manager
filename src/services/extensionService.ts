import * as vscode from 'vscode';
import { SALESFORCE_PUBLISHER } from '../constants';
import type { CodeCliService } from './codeCliService';
import type { SettingsService } from './settingsService';
import type { Logger } from '../util/logger';

export interface InstallOutcome {
  source: 'vsix' | 'marketplace';
  exitCode: number;
  stderr?: string;
}

/**
 * Routes through VsixInstaller in Phase 8. Until then, install() always
 * installs from the marketplace.
 */
export interface VsixInstallerLike {
  tryInstall(extensionId: string): Promise<'vsix' | 'marketplace' | 'skipped'>;
}

export class ExtensionService {
  private vsixInstaller: VsixInstallerLike | undefined;

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

  async enable(id: string): Promise<'ok' | 'manual-required'> {
    if (!this.isInstalled(id)) {
      this.logger.warn(`Cannot enable ${id}: not installed.`);
      return 'manual-required';
    }
    if (this.settings.getUseInternalCommands() && (await this.tryInternalToggle('enable', id))) {
      return 'ok';
    }
    return 'manual-required';
  }

  async disable(id: string): Promise<'ok' | 'manual-required'> {
    if (!this.isInstalled(id)) return 'ok';
    if (this.settings.getUseInternalCommands() && (await this.tryInternalToggle('disable', id))) {
      return 'ok';
    }
    return 'manual-required';
  }

  async showManualToggleHint(ids: string[], action: 'Enable' | 'Disable'): Promise<void> {
    if (ids.length === 0) return;
    await this.openExtensionsViewFor(ids, action);
  }

  private async tryInternalToggle(action: 'enable' | 'disable', id: string): Promise<boolean> {
    const command = `workbench.extensions.action.${action}Extension`;
    // Different VSCode versions accept different argument shapes for these
    // internal commands. Try the known variants in order.
    const variants: unknown[][] = [[[id]], [{ id }], [id]];
    for (const args of variants) {
      try {
        await vscode.commands.executeCommand(command, ...args);
        return true;
      } catch {
        // try next variant
      }
    }
    this.logger.warn(`No internal ${action} command shape worked for ${id}; manual toggle required.`);
    return false;
  }

  async install(id: string): Promise<InstallOutcome> {
    if (this.vsixInstaller) {
      const result = await this.vsixInstaller.tryInstall(id);
      if (result === 'vsix') {
        return { source: 'vsix', exitCode: 0 };
      }
      if (result === 'skipped') {
        return { source: 'marketplace', exitCode: 0 };
      }
    }
    const { exitCode, stderr } = await this.codeCli.installExtension(id);
    if (exitCode !== 0) {
      this.logger.error(`Install failed for ${id}`, stderr);
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
