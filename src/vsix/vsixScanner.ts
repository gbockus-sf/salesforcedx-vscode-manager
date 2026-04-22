import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { VsixOverride } from './types';

/**
 * Parses `<publisher>.<name>-<version>.vsix`. This is the filename shape
 * produced by `vsce package` by default.
 *
 * Examples:
 *   salesforce.salesforcedx-vscode-apex-63.1.0.vsix
 *   redhat.vscode-xml-0.26.0.vsix
 */
export const parseVsixFilename = (filename: string): VsixOverride | undefined => {
  const m = filename.match(/^([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)-(\d[^\s]*?)\.vsix$/i);
  if (!m) return undefined;
  const [, publisher, name, version] = m;
  return {
    extensionId: `${publisher}.${name}`,
    version,
    filePath: filename
  };
};

export class VsixScanner {
  constructor(private readonly dir: string) {}

  isConfigured(): boolean {
    return this.dir.length > 0;
  }

  exists(): boolean {
    if (!this.dir) return false;
    try {
      return fs.statSync(this.dir).isDirectory();
    } catch {
      return false;
    }
  }

  getDirectory(): string {
    return this.dir;
  }

  /**
   * Scans the configured directory and returns a map of the newest VSIX per
   * extension id. Returns an empty map if the directory is unset or missing.
   */
  scan(): Map<string, VsixOverride> {
    const out = new Map<string, VsixOverride>();
    if (!this.exists()) return out;
    let entries: string[];
    try {
      entries = fs.readdirSync(this.dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.vsix')) continue;
      const parsed = parseVsixFilename(entry);
      if (!parsed) continue;
      const absolute: VsixOverride = { ...parsed, filePath: path.join(this.dir, entry) };
      const existing = out.get(absolute.extensionId);
      if (!existing) {
        out.set(absolute.extensionId, absolute);
        continue;
      }
      // Prefer the newest by mtime; falls back to lexical version compare.
      try {
        const a = fs.statSync(existing.filePath).mtimeMs;
        const b = fs.statSync(absolute.filePath).mtimeMs;
        if (b > a) out.set(absolute.extensionId, absolute);
      } catch {
        if (absolute.version > existing.version) out.set(absolute.extensionId, absolute);
      }
    }
    return out;
  }

  /**
   * Watches the configured directory for `.vsix` add/remove/change. Caller
   * should dispose the returned Disposable on cleanup or when the directory
   * setting changes. Returns undefined if the directory is not configured.
   */
  watch(onChange: () => void): vscode.Disposable | undefined {
    if (!this.dir) return undefined;
    const pattern = new vscode.RelativePattern(this.dir, '*.vsix');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const subs: vscode.Disposable[] = [
      watcher.onDidCreate(onChange),
      watcher.onDidDelete(onChange),
      watcher.onDidChange(onChange),
      watcher
    ];
    return { dispose: () => subs.forEach(s => s.dispose()) };
  }
}
