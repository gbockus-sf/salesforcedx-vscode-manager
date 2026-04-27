import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import { getLocalization, LocalizationKeys } from '../localization';
import type { SettingsService } from '../services/settingsService';
import type { DependenciesTreeProvider } from '../views/dependenciesTreeProvider';

/**
 * Status-bar nudge that appears only when the Salesforce CLI has a
 * newer stable version than the installed one. Subscribes to the
 * Dependencies tree's `onDidChangeTreeData` so it refreshes whenever
 * the underlying check or latest-version state changes. Clicking the
 * item runs `sfdxManager.upgradeCli`, which opens a dedicated
 * terminal and invokes `sf update`.
 *
 * Hidden entirely when:
 *   - the `statusBar.showCliUpdate` setting is off, or
 *   - the dependency check hasn't reported an upgrade (which covers
 *     the offline / never-run / parity / `updateCheck=never` paths
 *     via `DependenciesTreeProvider.getCliUpdateInfo`).
 */
export class CliStatusBarItem implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly settings: SettingsService,
    private readonly tree: DependenciesTreeProvider
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.item.command = COMMANDS.upgradeCli;
    this.subscription = tree.onDidChangeTreeData(() => this.update());
    this.update();
  }

  update(): void {
    const info = this.tree.getCliUpdateInfo();
    if (!this.settings.getStatusBarShowCliUpdate() || !info) {
      this.item.hide();
      return;
    }
    this.item.text = getLocalization(LocalizationKeys.statusCliUpdateText, info.latest);
    this.item.tooltip = getLocalization(
      LocalizationKeys.statusCliUpdateTooltip,
      info.installed,
      info.latest
    );
    // Blue-ish "info" background to read as attention without alarm
    // — this isn't a failure, just an available upgrade.
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.item.show();
  }

  dispose(): void {
    this.subscription.dispose();
    this.item.dispose();
  }
}
