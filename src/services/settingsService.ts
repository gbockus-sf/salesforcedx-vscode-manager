import * as vscode from 'vscode';
import { CONFIG_NAMESPACE, DEFAULT_THIRD_PARTY_EXTENSION_IDS, SETTINGS, UpdateCheckMode } from '../constants';
import type { ApplyScope } from '../groups/types';

export class SettingsService {
  private config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  }

  getGroupsRaw(): Record<string, unknown> {
    return this.config().get<Record<string, unknown>>(SETTINGS.groups, {});
  }

  async updateGroupsRaw(groups: Record<string, unknown>): Promise<void> {
    await this.config().update(SETTINGS.groups, groups, vscode.ConfigurationTarget.Global);
  }

  getApplyScope(): ApplyScope {
    return this.config().get<ApplyScope>(SETTINGS.applyScope, 'disableOthers');
  }

  getUseInternalCommands(): boolean {
    return this.config().get<boolean>(SETTINGS.useInternalCommands, true);
  }

  getBackend(): 'codeCli' | 'profiles' {
    return this.config().get<'codeCli' | 'profiles'>(SETTINGS.backend, 'codeCli');
  }

  getAutoRunDependencyChecks(): boolean {
    return this.config().get<boolean>(SETTINGS.autoRunDependencyChecks, false);
  }

  getThirdPartyExtensionIds(): string[] {
    return this.config().get<string[]>(SETTINGS.thirdPartyExtensionIds, [
      ...DEFAULT_THIRD_PARTY_EXTENSION_IDS
    ]);
  }

  getVsixDirectory(): string {
    return this.config().get<string>(SETTINGS.vsixDirectory, '').trim();
  }

  getVsixAutoReinstallOnChange(): boolean {
    return this.config().get<boolean>(SETTINGS.vsixAutoReinstallOnChange, false);
  }

  getStatusBarShowGroup(): boolean {
    return this.config().get<boolean>(SETTINGS.statusBarShowGroup, true);
  }

  getStatusBarShowVsix(): boolean {
    return this.config().get<boolean>(SETTINGS.statusBarShowVsix, true);
  }

  getUpdateCheck(): UpdateCheckMode {
    return this.config().get<UpdateCheckMode>(SETTINGS.updateCheck, 'manual');
  }

  onDidChange(listener: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(CONFIG_NAMESPACE)) {
        listener(e);
      }
    });
  }
}
