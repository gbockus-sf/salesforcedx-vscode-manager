import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ProcessService } from './processService';

/**
 * Resolves the `code` CLI executable that ships alongside the running VSCode.
 * Used to install/uninstall extensions persistently.
 */
export class CodeCliService {
  private cachedPath: string | undefined;

  constructor(private readonly proc: ProcessService) {}

  resolve(): string {
    if (this.cachedPath) return this.cachedPath;
    const candidate = this.resolveFromAppRoot() ?? 'code';
    this.cachedPath = candidate;
    return candidate;
  }

  private resolveFromAppRoot(): string | undefined {
    const appRoot = vscode.env.appRoot;
    if (!appRoot) return undefined;
    const candidates = process.platform === 'win32'
      ? [path.join(appRoot, 'bin', 'code.cmd')]
      : [
          path.join(appRoot, 'bin', 'code'),
          path.join(appRoot, '..', '..', 'Resources', 'app', 'bin', 'code')
        ];
    return candidates.find(p => {
      try { return fs.existsSync(p); } catch { return false; }
    });
  }

  installExtension(idOrVsixPath: string, force = false) {
    const args = ['--install-extension', idOrVsixPath];
    if (force) args.push('--force');
    return this.proc.run(this.resolve(), args, 60_000);
  }

  uninstallExtension(id: string) {
    return this.proc.run(this.resolve(), ['--uninstall-extension', id], 30_000);
  }

  listInstalledWithVersions() {
    return this.proc.run(this.resolve(), ['--list-extensions', '--show-versions'], 30_000);
  }
}
