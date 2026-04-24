import * as vscode from 'vscode';
import { getLocalization, LocalizationKeys } from '../localization';
import type { ExtensionService } from '../services/extensionService';
import type { VsixOverride } from '../vsix/types';
import type { VsixScanner } from '../vsix/vsixScanner';

export interface VsixNode {
  kind: 'vsix';
  extensionId: string;
  version: string;
  filePath: string;
  matchedBy?: 'strict' | 'prefix';
}

/**
 * Top-level view that lists every `.vsix` currently in the override
 * directory. A sibling of the Groups and Dependencies views; hidden
 * from the activity-bar container via the `sfdxManager.hasVsixOverrides`
 * context key when there are no overrides.
 *
 * Each row represents one `.vsix` file. Actions on the row
 * (reveal / remove) edit the directory — no install/uninstall
 * toggles here because VSIX overrides are authoritative: the file's
 * presence is the install state. Lifecycle:
 *   1. User drops a `.vsix` in the directory.
 *   2. `VsixScanner` watcher fires → we `setContext` the key true,
 *      the view appears, `VsixInstaller.autoInstallAll()` runs.
 *   3. User removes the file (via the trash action or manually) →
 *      watcher fires again → we refresh the view; when the last
 *      override is gone the context key flips false and the view
 *      disappears.
 */
export class VsixTreeProvider implements vscode.TreeDataProvider<VsixNode> {
  private readonly emitter = new vscode.EventEmitter<VsixNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private scanner: VsixScanner,
    private readonly extensions: ExtensionService
  ) {}

  /**
   * Swap the backing scanner — used when the vsix-directory setting
   * changes and `extension.ts` rebuilds the scanner. Keeps the
   * existing tree provider instance (and its registered view) alive
   * so VSCode doesn't flash the view away and back on a setting flip.
   */
  setScanner(scanner: VsixScanner): void {
    this.scanner = scanner;
    this.refresh();
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(node: VsixNode): vscode.TreeItem {
    const label = this.extensions.label(node.extensionId);
    const filename = node.filePath.split('/').pop() ?? node.filePath;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = getLocalization(
      LocalizationKeys.vsixTreeNodeDescription,
      stripLeadingV(node.version),
      filename
    );
    item.tooltip = getLocalization(
      LocalizationKeys.vsixTreeNodeTooltip,
      node.extensionId,
      stripLeadingV(node.version),
      node.filePath
    );
    item.iconPath = new vscode.ThemeIcon('package');
    item.contextValue = 'vsix:override';
    // `resourceUri` lets VSCode open the file via the default handler
    // if the user double-clicks. Harmless for .vsix files — VSCode
    // will prompt to install, which matches the intent.
    item.resourceUri = vscode.Uri.file(node.filePath);
    return item;
  }

  getChildren(parent?: VsixNode): VsixNode[] {
    if (parent) return [];
    const overrides = this.scanner.scan();
    const rows: VsixNode[] = [];
    for (const [, entry] of overrides) rows.push(toNode(entry));
    rows.sort((a, b) => a.extensionId.localeCompare(b.extensionId));
    return rows;
  }
}

const toNode = (entry: VsixOverride): VsixNode => ({
  kind: 'vsix',
  extensionId: entry.extensionId,
  version: entry.version,
  filePath: entry.filePath,
  matchedBy: entry.matchedBy
});

const stripLeadingV = (raw: string): string =>
  raw.startsWith('v') || raw.startsWith('V') ? raw.slice(1) : raw;
