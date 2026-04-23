import * as vscode from 'vscode';
import { getLocalization, LocalizationKeys } from '../localization';
import type { Logger } from './logger';

/**
 * VSCode's `showInformationMessage(msg)` with no action buttons will
 * auto-dismiss after a few seconds. The manager surfaces several
 * notifications that describe post-apply state the user needs to notice
 * — those must stay visible until the user acknowledges them. Attaching
 * at least one action button flips the notification into "sticky" mode:
 * VSCode keeps it in the tray until the user picks an item or closes it
 * with the X.
 *
 * These helpers are the single place the extension opts into sticky
 * behavior, so we don't re-implement the dismiss / show-log dance at
 * every call site.
 */

const DISMISS = () => getLocalization(LocalizationKeys.notifyDismiss);
const SHOW_LOG = () => getLocalization(LocalizationKeys.showLog);

export interface NotifyOptions {
  /** When provided, adds a "Show Log" button that calls `logger.show()`. */
  logger?: Logger;
  /**
   * Extra action buttons. Selecting one resolves the returned promise
   * with the button's label. The helper always appends a final Dismiss
   * button so the notification is sticky regardless of whether the
   * caller supplied their own actions.
   */
  actions?: readonly string[];
}

const show = async (
  kind: 'info' | 'warn' | 'error',
  message: string,
  options: NotifyOptions = {}
): Promise<string | undefined> => {
  const buttons: string[] = [];
  if (options.actions) buttons.push(...options.actions);
  if (options.logger) buttons.push(SHOW_LOG());
  buttons.push(DISMISS());
  const api =
    kind === 'warn'
      ? vscode.window.showWarningMessage
      : kind === 'error'
        ? vscode.window.showErrorMessage
        : vscode.window.showInformationMessage;
  const picked = await api(message, ...buttons);
  if (picked === DISMISS()) return undefined;
  if (picked === SHOW_LOG() && options.logger) {
    options.logger.show();
    return undefined;
  }
  return picked;
};

/** Sticky info notification. Resolves with the picked action label, or undefined on dismiss. */
export const notifyInfo = (
  message: string,
  options?: NotifyOptions
): Promise<string | undefined> => show('info', message, options);

/** Sticky warning notification. */
export const notifyWarn = (
  message: string,
  options?: NotifyOptions
): Promise<string | undefined> => show('warn', message, options);

/** Sticky error notification. */
export const notifyError = (
  message: string,
  options?: NotifyOptions
): Promise<string | undefined> => show('error', message, options);
