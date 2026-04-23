import * as vscode from 'vscode';
import { notifyError, notifyInfo, notifyWarn } from '../../src/util/notify';
import type { Logger } from '../../src/util/logger';

const mkLogger = (): Logger => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  show: jest.fn(), dispose: jest.fn()
} as unknown as Logger);

describe('notify helpers', () => {
  beforeEach(() => {
    (vscode.window.showInformationMessage as jest.Mock).mockReset();
    (vscode.window.showWarningMessage as jest.Mock).mockReset();
    (vscode.window.showErrorMessage as jest.Mock).mockReset();
  });

  it('notifyInfo always passes at least one button so the notification stays sticky', async () => {
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
    await notifyInfo('hello');
    const args = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0];
    // First arg is the message; rest are the button labels. VSCode only
    // keeps a notification open until dismissed when it has >= 1 button.
    expect(args.slice(1).length).toBeGreaterThanOrEqual(1);
  });

  it('notifyInfo appends a Show Log button when a logger is provided', async () => {
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
    await notifyInfo('hello', { logger: mkLogger() });
    const args = (vscode.window.showInformationMessage as jest.Mock).mock.calls[0];
    const buttons = args.slice(1) as string[];
    expect(buttons).toContain('Show Log');
  });

  it('notifyInfo calls logger.show() when the user picks Show Log', async () => {
    const logger = mkLogger();
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Show Log');
    await notifyInfo('hello', { logger });
    expect(logger.show).toHaveBeenCalled();
  });

  it('notifyWarn routes through showWarningMessage, not info', async () => {
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
    await notifyWarn('watch out');
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('notifyError routes through showErrorMessage, not info', async () => {
    (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);
    await notifyError('oh no');
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('returns the picked action (not Dismiss / not Show Log) back to the caller', async () => {
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Retry');
    const picked = await notifyInfo('hello', { actions: ['Retry'] });
    expect(picked).toBe('Retry');
  });

  it('returns undefined when the user picks Dismiss', async () => {
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Dismiss');
    const picked = await notifyInfo('hello');
    expect(picked).toBeUndefined();
  });
});
