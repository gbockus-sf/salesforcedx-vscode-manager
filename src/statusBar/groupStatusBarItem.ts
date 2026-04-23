import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { GroupStore } from '../groups/groupStore';
import { getLocalization, LocalizationKeys } from '../localization';
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
    const label = group?.label ?? getLocalization(LocalizationKeys.statusGroupNone);
    this.item.text = getLocalization(LocalizationKeys.statusGroupText, label);
    this.item.tooltip = group
      ? getLocalization(LocalizationKeys.statusGroupTooltipActive, group.label)
      : getLocalization(LocalizationKeys.statusGroupTooltipNone);
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
