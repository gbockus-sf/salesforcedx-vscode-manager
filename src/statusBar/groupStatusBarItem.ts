import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { GroupStore } from '../groups/groupStore';
import type { SettingsService } from '../services/settingsService';
import type { WorkspaceStateService } from '../services/workspaceStateService';

export class GroupStatusBarItem implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(
    private readonly store: GroupStore,
    private readonly workspaceState: WorkspaceStateService,
    private readonly settings: SettingsService
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = COMMANDS.applyGroupQuickPick;
    this.update();
  }

  update(): void {
    if (!this.settings.getStatusBarShowGroup()) {
      this.item.hide();
      return;
    }
    const id = this.workspaceState.getActiveGroupId();
    const group = id ? this.store.get(id) : undefined;
    const label = group?.label ?? 'None';
    this.item.text = `$(layers) ${label}`;
    this.item.tooltip = group
      ? `Active SFDX group: ${group.label} — click to switch`
      : 'No SFDX group applied — click to pick one';
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
