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
    filePath: filename,
    matchedBy: 'strict'
  };
};

/**
 * Fuzzy fallback for filenames that don't match the strict shape above.
 * Internal / CI builds often drop the publisher and rename artifacts
 * (e.g. `salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix`). When
 * the user drops one of those in the override directory their intent is
 * obvious: "match this to the managed extension whose id looks like
 * this filename's prefix."
 *
 * Returns a synthesized `VsixOverride` keyed on the managed extension
 * id whose `name` portion (id minus publisher prefix) is the longest
 * prefix of the lowercased filename stem, with the prefix boundary
 * being end-of-string, `-`, or `.` — so `salesforcedx-vscode-apex`
 * doesn't spuriously match `salesforcedx-vscode-apex-oas-...`.
 *
 * When no managed id qualifies, returns `undefined` and the caller
 * skips the file (matching the current silent-skip behavior for
 * unparseable names).
 */
export const parseVsixFilenameFuzzy = (
  filename: string,
  managedIds: readonly string[]
): VsixOverride | undefined => {
  // Only operate on `.vsix` files. Case-insensitive match mirrors
  // scan()'s entry filter.
  if (!/\.vsix$/i.test(filename)) return undefined;
  // Strip `.vsix` + an optional trailing `-<version>` (same version
  // shape the strict parser accepts: starts with a digit, may include
  // `.`, `-`, alphanumerics). Anything without a trailing version
  // suffix keeps the whole stem and gets a `0.0.0` sentinel version
  // — downstream install still works (`code --install-extension <path>`
  // doesn't care about the parsed version, only the file).
  const stemWithVersion = filename.replace(/\.vsix$/i, '');
  const versionMatch = stemWithVersion.match(/^(.*?)-(\d[^\s-][\w.-]*)$/);
  const stem = (versionMatch ? versionMatch[1] : stemWithVersion).toLowerCase();
  const version = versionMatch ? versionMatch[2] : '0.0.0';
  if (!stem) return undefined;

  let best: { id: string; name: string } | undefined;
  for (const id of managedIds) {
    // id is `publisher.name`; the name portion is what external build
    // artifacts typically use as their prefix.
    const dot = id.indexOf('.');
    if (dot < 0) continue;
    const name = id.slice(dot + 1).toLowerCase();
    if (!name) continue;
    // Prefix with boundary guard: stem[name.length] must be `-`, `.`,
    // or absent. Keeps `apex` from matching `apex-oas`.
    if (!stem.startsWith(name)) continue;
    const boundary = stem.charAt(name.length);
    if (boundary !== '' && boundary !== '-' && boundary !== '.') continue;
    if (!best || name.length > best.name.length) best = { id, name };
  }
  if (!best) return undefined;
  return {
    extensionId: best.id,
    version,
    filePath: filename,
    matchedBy: 'prefix'
  };
};

export class VsixScanner {
  private getManagedIds: (() => readonly string[]) | undefined;

  constructor(private readonly dir: string) {}

  /**
   * Supplies the scanner with the current list of `managed()` extension
   * ids so `scan()` can fuzzy-match oddly-named VSIX files (CI builds,
   * renamed artifacts, publisher-less filenames). Unset = strict
   * matching only. Wire this once in `extension.ts`; the lookup is
   * called fresh on every `scan()` so the list stays in sync with
   * whatever `ExtensionService.managed()` currently reports.
   */
  setManagedIdLookup(fn: () => readonly string[]): void {
    this.getManagedIds = fn;
  }

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
    const managedIds = this.getManagedIds?.() ?? [];
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.vsix')) continue;
      // Strict parse wins; fuzzy is the fallback so well-formed
      // artifacts never pay the prefix-walk cost.
      const parsed =
        parseVsixFilename(entry) ??
        (managedIds.length ? parseVsixFilenameFuzzy(entry, managedIds) : undefined);
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
