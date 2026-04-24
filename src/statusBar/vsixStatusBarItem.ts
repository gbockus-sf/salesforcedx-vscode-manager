import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import { getLocalization, LocalizationKeys } from '../localization';
import type { SettingsService } from '../services/settingsService';
import type { VsixInstaller } from '../vsix/vsixInstaller';
import type { BusyState } from '../util/busyState';

export class VsixStatusBarItem implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly busySubscription?: vscode.Disposable;

  constructor(
    private readonly settings: SettingsService,
    private installer: VsixInstaller,
    private readonly busy?: BusyState
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.item.command = COMMANDS.vsixMenu;
    this.busySubscription = this.busy?.onChange(() => this.update());
    this.update();
  }

  setInstaller(installer: VsixInstaller): void {
    this.installer = installer;
    this.update();
  }

  update(): void {
    if (!this.settings.getStatusBarShowVsix() || !this.settings.getVsixDirectory()) {
      this.item.hide();
      return;
    }
    const sources = this.installer.currentSources();
    const count = Object.values(sources).filter(s => s === 'vsix').length;
    const dir = this.settings.getVsixDirectory();
    const isBusy = this.busy?.hasAny() ?? false;
    const text = getLocalization(LocalizationKeys.statusVsixText, count);
    this.item.text = isBusy ? `$(sync~spin) ${text}` : text;
    this.item.tooltip = count > 0
      ? getLocalization(LocalizationKeys.statusVsixTooltipActive, count, dir)
      : getLocalization(LocalizationKeys.statusVsixTooltipIdle, dir);
    this.item.backgroundColor = count > 0
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    this.item.show();
  }

  dispose(): void {
    this.busySubscription?.dispose();
    this.item.dispose();
  }
}
