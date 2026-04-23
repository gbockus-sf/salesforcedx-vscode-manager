import * as vscode from 'vscode';
import {
  CONFIG_NAMESPACE,
  DEFAULT_THIRD_PARTY_EXTENSION_IDS,
  ReloadAfterApplyMode,
  SETTINGS,
  UpdateCheckMode
} from '../constants';
import type { ApplyScope } from '../groups/types';

export class SettingsService {
  private config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  }

  getGroupsRaw(): Record<string, unknown> {
    // VSCode's `.get()` already merges layers (workspace over user over
    // default) before returning a single object, so callers that just need
    // "the effective groups" use this.
    return this.config().get<Record<string, unknown>>(SETTINGS.groups, {});
  }

  /**
   * Returns the raw entries for each configuration layer separately so the
   * caller can decide which one to write to. Workspace entries override
   * user entries at the same id — this is standard VSCode behavior.
   */
  getGroupsByScope(): {
    user: Record<string, unknown>;
    workspace: Record<string, unknown>;
  } {
    const inspected = this.config().inspect<Record<string, unknown>>(SETTINGS.groups);
    return {
      user: inspected?.globalValue ?? {},
      workspace: inspected?.workspaceValue ?? {}
    };
  }

  async updateGroupsRaw(
    groups: Record<string, unknown>,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    await this.config().update(SETTINGS.groups, groups, target);
  }

  getApplyScope(): ApplyScope {
    return this.config().get<ApplyScope>(SETTINGS.applyScope, 'disableOthers');
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

  getReloadAfterApply(): ReloadAfterApplyMode {
    return this.config().get<ReloadAfterApplyMode>(SETTINGS.reloadAfterApply, 'prompt');
  }

  onDidChange(listener: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(CONFIG_NAMESPACE)) {
        listener(e);
      }
    });
  }
}
