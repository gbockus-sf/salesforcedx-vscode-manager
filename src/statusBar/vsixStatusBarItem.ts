import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { SettingsService } from '../services/settingsService';
import type { VsixInstaller } from '../vsix/vsixInstaller';

export class VsixStatusBarItem implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(
    private readonly settings: SettingsService,
    private installer: VsixInstaller
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.item.command = COMMANDS.vsixMenu;
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
    this.item.text = `$(package) VSIX: ${count}`;
    this.item.tooltip = count > 0
      ? `${count} extension(s) loaded from ${this.settings.getVsixDirectory()} — click to manage.`
      : `VSIX directory: ${this.settings.getVsixDirectory()} — no overrides active. Click to manage.`;
    this.item.backgroundColor = count > 0
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
