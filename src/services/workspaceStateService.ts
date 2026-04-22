import * as vscode from 'vscode';
import { WORKSPACE_STATE } from '../constants';
import type { ApplyScope } from '../groups/types';

export type InstallSource = 'vsix' | 'marketplace';

export class WorkspaceStateService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getActiveGroupId(): string | undefined {
    return this.context.workspaceState.get<string>(WORKSPACE_STATE.activeGroupId);
  }

  async setActiveGroupId(id: string | undefined): Promise<void> {
    await this.context.workspaceState.update(WORKSPACE_STATE.activeGroupId, id);
  }

  getInstallSources(): Record<string, InstallSource> {
    return this.context.globalState.get<Record<string, InstallSource>>(WORKSPACE_STATE.installSource, {});
  }

  async setInstallSource(extensionId: string, source: InstallSource | undefined): Promise<void> {
    const current = this.getInstallSources();
    if (source === undefined) {
      delete current[extensionId];
    } else {
      current[extensionId] = source;
    }
    await this.context.globalState.update(WORKSPACE_STATE.installSource, current);
  }

  async clearInstallSources(): Promise<void> {
    await this.context.globalState.update(WORKSPACE_STATE.installSource, {});
  }

  getApplyScopeChoice(groupId: string): ApplyScope | undefined {
    const all = this.context.workspaceState.get<Record<string, ApplyScope>>(WORKSPACE_STATE.applyScopeChoice, {});
    return all[groupId];
  }

  async setApplyScopeChoice(groupId: string, scope: ApplyScope): Promise<void> {
    const all = this.context.workspaceState.get<Record<string, ApplyScope>>(WORKSPACE_STATE.applyScopeChoice, {});
    all[groupId] = scope;
    await this.context.workspaceState.update(WORKSPACE_STATE.applyScopeChoice, all);
  }
}
