import * as vscode from 'vscode';

export class Logger {
  private readonly channel: vscode.OutputChannel;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name);
  }

  info(message: string): void {
    this.channel.appendLine(`[info] ${message}`);
  }

  warn(message: string): void {
    this.channel.appendLine(`[warn] ${message}`);
  }

  error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? `: ${err.message}` : err ? `: ${String(err)}` : '';
    this.channel.appendLine(`[error] ${message}${detail}`);
    if (err instanceof Error && err.stack) {
      this.channel.appendLine(err.stack);
    }
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
