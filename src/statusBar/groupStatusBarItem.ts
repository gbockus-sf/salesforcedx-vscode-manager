import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { GroupStore } from '../groups/groupStore';
import { getLocalization, LocalizationKeys } from '../localization';
import type { SettingsService } from '../services/settingsService';
import type { WorkspaceStateService } from '../services/workspaceStateService';
import type { BusyState } from '../util/busyState';

export class GroupStatusBarItem implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly busySubscription?: vscode.Disposable;

  constructor(
    private readonly store: GroupStore,
    private readonly workspaceState: WorkspaceStateService,
    private readonly settings: SettingsService,
    private readonly busy?: BusyState
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = COMMANDS.applyGroupQuickPick;
    this.busySubscription = this.busy?.onChange(() => this.update());
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
    const isBusy = this.busy?.hasAny() ?? false;
    // Prefix the text with `$(sync~spin)` when anything's in flight so
    // the status bar mirrors the tree's frozen state at a glance.
    const text = getLocalization(LocalizationKeys.statusGroupText, label);
    this.item.text = isBusy ? `$(sync~spin) ${text}` : text;
    this.item.tooltip = group
      ? getLocalization(LocalizationKeys.statusGroupTooltipActive, group.label)
      : getLocalization(LocalizationKeys.statusGroupTooltipNone);
    this.item.show();
  }

  dispose(): void {
    this.busySubscription?.dispose();
    this.item.dispose();
  }
}
