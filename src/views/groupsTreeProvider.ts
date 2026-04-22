import * as vscode from 'vscode';
import type { Group } from '../groups/types';
import type { GroupStore } from '../groups/groupStore';
import type { ExtensionService } from '../services/extensionService';
import type { WorkspaceStateService } from '../services/workspaceStateService';

export type GroupsNode = GroupNode | ExtensionNode;

interface GroupNode {
  kind: 'group';
  group: Group;
  isActive: boolean;
}

interface ExtensionNode {
  kind: 'extension';
  extensionId: string;
  groupId: string;
  installed: boolean;
  enabled: boolean;
  source: 'vsix' | 'marketplace' | 'unknown';
  vsixFilename?: string;
}

export class GroupsTreeProvider implements vscode.TreeDataProvider<GroupsNode> {
  private readonly emitter = new vscode.EventEmitter<GroupsNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private getVsixSources: (() => Record<string, 'vsix' | 'marketplace'>) | undefined;
  private getVsixOverrides: (() => Map<string, { version: string; filePath: string }>) | undefined;

  constructor(
    private readonly store: GroupStore,
    private readonly extensions: ExtensionService,
    private readonly workspaceState: WorkspaceStateService
  ) {}

  setVsixSources(fn: () => Record<string, 'vsix' | 'marketplace'>): void {
    this.getVsixSources = fn;
  }

  setVsixOverrides(fn: () => Map<string, { version: string; filePath: string }>): void {
    this.getVsixOverrides = fn;
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(node: GroupsNode): vscode.TreeItem {
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(
        node.group.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = node.isActive ? 'active' : node.group.builtIn ? 'built-in' : 'custom';
      item.tooltip = node.group.description ?? node.group.label;
      item.iconPath = new vscode.ThemeIcon(node.isActive ? 'check' : 'layers');
      item.contextValue = `group:${node.group.builtIn ? 'builtIn' : 'user'}`;
      return item;
    }

    const short = node.extensionId.split('.').slice(1).join('.') || node.extensionId;
    const item = new vscode.TreeItem(short, vscode.TreeItemCollapsibleState.None);
    item.description = !node.installed
      ? 'not installed'
      : !node.enabled
        ? 'disabled'
        : node.source === 'vsix'
          ? 'vsix'
          : undefined;
    item.tooltip = node.source === 'vsix' && node.vsixFilename
      ? `${node.extensionId} — installed from local VSIX: ${node.vsixFilename}`
      : node.extensionId;
    item.iconPath = !node.installed
      ? new vscode.ThemeIcon('circle-slash')
      : !node.enabled
        ? new vscode.ThemeIcon('circle-outline')
        : node.source === 'vsix'
          ? new vscode.ThemeIcon('package')
          : new vscode.ThemeIcon('check');
    item.contextValue = 'extension';
    return item;
  }

  getChildren(parent?: GroupsNode): GroupsNode[] {
    if (!parent) {
      const activeId = this.workspaceState.getActiveGroupId();
      return this.store.list().map(group => ({
        kind: 'group' as const,
        group,
        isActive: group.id === activeId
      }));
    }
    if (parent.kind !== 'group') return [];
    const sources = this.getVsixSources
      ? this.getVsixSources()
      : this.workspaceState.getInstallSources();
    const overrides = this.getVsixOverrides?.();
    return parent.group.extensions.map(id => {
      const override = overrides?.get(id);
      return {
        kind: 'extension' as const,
        extensionId: id,
        groupId: parent.group.id,
        installed: this.extensions.isInstalled(id),
        enabled: this.extensions.isEnabled(id),
        source: sources[id] ?? 'unknown',
        vsixFilename: override?.filePath.split('/').pop()
      };
    });
  }
}
