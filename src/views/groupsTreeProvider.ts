import * as vscode from 'vscode';
import type { Group } from '../groups/types';
import type { GroupStore } from '../groups/groupStore';
import { getLocalization, LocalizationKeys } from '../localization';
import type { ExtensionService, NodeVersionInfo } from '../services/extensionService';
import type { WorkspaceStateService } from '../services/workspaceStateService';

export type GroupsNode = GroupNode | ExtensionNode | DependencyChildNode;

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
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
}

/**
 * Read-only informational child shown under an extension node in the tree.
 * Lists the extension's `extensionDependencies` ("dep") and
 * `extensionPack` members ("pack") so the user can see why disable might be
 * blocked and what gets pulled in when enabling.
 */
interface DependencyChildNode {
  kind: 'dep-child';
  relation: 'dep' | 'pack';
  parentExtensionId: string;
  extensionId: string;
  installed: boolean;
  enabled: boolean;
}

export class GroupsTreeProvider implements vscode.TreeDataProvider<GroupsNode> {
  private readonly emitter = new vscode.EventEmitter<GroupsNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private getVsixSources: (() => Record<string, 'vsix' | 'marketplace'>) | undefined;
  private getVsixOverrides: (() => Map<string, { version: string; filePath: string }>) | undefined;
  private readonly versionInfoCache = new Map<string, NodeVersionInfo>();
  private refreshInFlight: Promise<void> | undefined;

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

  /**
   * Re-pull installed version + latest-version state for every member of
   * every group. Fires `onDidChangeTreeData` once complete so pre-existing
   * items get re-rendered with update badges. Silently swallows errors —
   * this path must never surface network failures to the user.
   */
  async refreshVersionInfo(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        await this.extensions.refreshInstalledCliVersions();
        const ids = new Set<string>();
        for (const group of this.store.list()) {
          for (const id of group.extensions) ids.add(id);
        }
        for (const id of ids) {
          try {
            const info = await this.extensions.getNodeVersionInfo(id);
            this.versionInfoCache.set(id, info);
          } catch {
            // Ignore — keep whatever cache entry we already had.
          }
        }
      } finally {
        this.refreshInFlight = undefined;
        this.refresh();
      }
    })();
    return this.refreshInFlight;
  }

  /** Cached version info for an id — returns `undefined` before first refresh. */
  getVersionInfo(id: string): NodeVersionInfo | undefined {
    return this.versionInfoCache.get(id);
  }

  getTreeItem(node: GroupsNode): vscode.TreeItem {
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(
        node.group.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      const scope = this.store.getScope(node.group.id);
      const scopeBadge =
        scope === 'workspace'
          ? getLocalization(LocalizationKeys.scopeBadgeWorkspace)
          : scope === 'user'
            ? getLocalization(LocalizationKeys.scopeBadgeUser)
            : undefined;
      const labels: string[] = [];
      if (node.isActive) labels.push(getLocalization(LocalizationKeys.groupActive));
      labels.push(
        node.group.source === 'pack'
          ? getLocalization(LocalizationKeys.groupExtensionPack)
          : node.group.builtIn
            ? getLocalization(LocalizationKeys.groupBuiltIn)
            : getLocalization(LocalizationKeys.groupCustom)
      );
      if (scopeBadge) labels.push(scopeBadge);
      item.description = labels.join(' · ');
      // Pack groups get a distinct icon so they stand out from the
      // handcrafted Apex / Lightning / React built-ins.
      item.iconPath = new vscode.ThemeIcon(
        node.isActive ? 'check' : node.group.source === 'pack' ? 'package' : 'layers'
      );
      item.contextValue = node.group.source === 'pack'
        ? 'group:pack'
        : `group:${node.group.builtIn ? 'builtIn' : 'user'}`;
      item.tooltip = node.group.description ?? node.group.label;
      return item;
    }

    if (node.kind === 'dep-child') {
      const short = node.extensionId.split('.').slice(1).join('.') || node.extensionId;
      const item = new vscode.TreeItem(short, vscode.TreeItemCollapsibleState.None);
      item.description = node.relation === 'pack'
        ? getLocalization(LocalizationKeys.dependencyChildPack)
        : getLocalization(LocalizationKeys.dependencyChildDep);
      const state = !node.installed
        ? getLocalization(LocalizationKeys.dependencyChildNotInstalled)
        : node.enabled
          ? getLocalization(LocalizationKeys.dependencyChildEnabled)
          : getLocalization(LocalizationKeys.dependencyChildDisabled);
      item.tooltip = `${node.extensionId} (${state})`;
      item.iconPath = new vscode.ThemeIcon(node.relation === 'pack' ? 'package' : 'link');
      item.contextValue = `extension:child:${node.relation}`;
      return item;
    }

    const short = node.extensionId.split('.').slice(1).join('.') || node.extensionId;
    const hasChildren =
      this.extensionDependenciesOf(node.extensionId).length > 0 ||
      this.extensionPackOf(node.extensionId).length > 0;
    const item = new vscode.TreeItem(
      short,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.description = this.formatDescription(node);
    item.tooltip = this.buildTooltip(node);
    item.iconPath = this.resolveIcon(node);
    item.contextValue = this.resolveContextValue(node);
    return item;
  }

  private extensionDependenciesOf(id: string): string[] {
    const pkg = this.extensions.readManifest<{ extensionDependencies?: unknown }>(id);
    return Array.isArray(pkg?.extensionDependencies)
      ? (pkg!.extensionDependencies as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
  }

  private extensionPackOf(id: string): string[] {
    const pkg = this.extensions.readManifest<{ extensionPack?: unknown }>(id);
    return Array.isArray(pkg?.extensionPack)
      ? (pkg!.extensionPack as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
  }

  private formatDescription(node: ExtensionNode): string {
    if (!node.installed) return getLocalization(LocalizationKeys.extensionNotInstalled);
    const bits: string[] = [];
    if (node.installedVersion) bits.push(`v${stripLeadingV(node.installedVersion)}`);
    if (!node.enabled) bits.push(getLocalization(LocalizationKeys.extensionDisabled));
    if (node.source === 'vsix') bits.push(getLocalization(LocalizationKeys.extensionVsixBadge));
    if (node.updateAvailable && node.latestVersion) {
      bits.push(getLocalization(LocalizationKeys.extensionUpdateBadge, stripLeadingV(node.latestVersion)));
    }
    return bits.length > 0 ? bits.join(' · ') : '';
  }

  private buildTooltip(node: ExtensionNode): string {
    const lines: string[] = [node.extensionId];
    if (node.installedVersion) {
      lines.push(getLocalization(LocalizationKeys.extensionInstalledLine, stripLeadingV(node.installedVersion)));
    }
    if (node.latestVersion && node.updateAvailable) {
      lines.push(
        getLocalization(LocalizationKeys.extensionMarketplaceUpdateLine, stripLeadingV(node.latestVersion))
      );
    }
    if (node.source === 'vsix') {
      lines.push(
        node.vsixFilename
          ? getLocalization(LocalizationKeys.extensionVsixTooltip, node.vsixFilename)
          : getLocalization(LocalizationKeys.extensionVsixTooltipGeneric)
      );
      lines.push(getLocalization(LocalizationKeys.extensionVsixWalkthroughHint));
    }
    return lines.join('\n');
  }

  private resolveIcon(node: ExtensionNode): vscode.ThemeIcon {
    if (!node.installed) return new vscode.ThemeIcon('circle-slash');
    if (!node.enabled) return new vscode.ThemeIcon('circle-outline');
    if (node.updateAvailable) return new vscode.ThemeIcon('arrow-circle-up');
    if (node.source === 'vsix') return new vscode.ThemeIcon('package');
    return new vscode.ThemeIcon('check');
  }

  private resolveContextValue(node: ExtensionNode): string {
    const flags: string[] = ['extension'];
    if (node.updateAvailable) flags.push('updateAvailable');
    if (node.source === 'vsix') flags.push('vsix');
    return flags.join(':');
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
    if (parent.kind === 'group') {
      const sources = this.getVsixSources
        ? this.getVsixSources()
        : this.workspaceState.getInstallSources();
      const overrides = this.getVsixOverrides?.();
      return parent.group.extensions.map(id => {
        const override = overrides?.get(id);
        const versionInfo = this.versionInfoCache.get(id);
        const installed = this.extensions.isInstalled(id);
        const installedVersion =
          versionInfo?.installedVersion ?? (installed ? this.extensions.getInstalledVersion(id) : undefined);
        return {
          kind: 'extension' as const,
          extensionId: id,
          groupId: parent.group.id,
          installed,
          enabled: this.extensions.isEnabled(id),
          source: sources[id] ?? 'unknown',
          vsixFilename: override?.filePath.split('/').pop(),
          installedVersion,
          latestVersion: versionInfo?.latestVersion,
          updateAvailable: versionInfo?.updateAvailable ?? false
        };
      });
    }
    if (parent.kind === 'extension') {
      const deps = this.extensionDependenciesOf(parent.extensionId).map(id => ({
        kind: 'dep-child' as const,
        relation: 'dep' as const,
        parentExtensionId: parent.extensionId,
        extensionId: id,
        installed: this.extensions.isInstalled(id),
        enabled: this.extensions.isEnabled(id)
      }));
      const packMembers = this.extensionPackOf(parent.extensionId).map(id => ({
        kind: 'dep-child' as const,
        relation: 'pack' as const,
        parentExtensionId: parent.extensionId,
        extensionId: id,
        installed: this.extensions.isInstalled(id),
        enabled: this.extensions.isEnabled(id)
      }));
      return [...deps, ...packMembers];
    }
    return [];
  }
}

const stripLeadingV = (raw: string): string =>
  raw.startsWith('v') || raw.startsWith('V') ? raw.slice(1) : raw;
