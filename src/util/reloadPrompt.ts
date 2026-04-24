import * as vscode from 'vscode';
import { getLocalization, LocalizationKeys } from '../localization';
import type { SettingsService } from '../services/settingsService';

/**
 * Surfaces a "Reload Window" prompt after any state change the user
 * needs VSCode to re-snapshot to fully see — apply / install / uninstall
 * / update. `vscode.extensions.all` only refreshes on reload, so the
 * Extensions view and our own Groups tree show stale data until we
 * reload. This helper consolidates every per-op reload prompt into a
 * single action-button notification driven by the
 * `salesforcedx-vscode-manager.reloadAfterApply` setting.
 *
 *   - `auto`   → reload silently.
 *   - `prompt` → one info toast with a `Reload Window` action button.
 *   - `never`  → no-op; we rely on VSCode's own per-extension banners
 *                (which users turned on in this mode deliberately).
 *
 * `touched` is the single signal: caller decides whether the op
 * actually changed disk state (a no-op apply or an already-installed
 * install shouldn't nag the user to reload).
 */
export const maybeReloadAfterChange = async (
  touched: boolean,
  settings: SettingsService
): Promise<void> => {
  if (!touched) return;
  const mode = settings.getReloadAfterApply();
  if (mode === 'never') return;
  if (mode === 'auto') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
    return;
  }
  const reloadChoice = getLocalization(LocalizationKeys.reloadAfterApplyAction);
  const pick = await vscode.window.showInformationMessage(
    getLocalization(LocalizationKeys.reloadAfterApplyPrompt),
    reloadChoice
  );
  if (pick === reloadChoice) {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
};
