import * as vscode from 'vscode';
import type { DependencyRegistry } from '../dependencies/registry';
import type { DependencyCheck, DependencyStatus } from '../dependencies/types';
import { getLocalization, LocalizationKeys } from '../localization';
import { compare } from '../dependencies/versionCompare';

export type DependenciesNode = CategoryNode | CheckNode;

interface CategoryNode {
  kind: 'category';
  category: DependencyCheck['category'];
  checks: DependencyCheck[];
}

interface CheckNode {
  kind: 'check';
  check: DependencyCheck;
  status: DependencyStatus;
}

const categoryLabel = (category: DependencyCheck['category']): string => {
  switch (category) {
    case 'cli': return getLocalization(LocalizationKeys.depCategoryCli);
    case 'runtime': return getLocalization(LocalizationKeys.depCategoryRuntime);
    case 'per-extension': return getLocalization(LocalizationKeys.depCategoryPerExtension);
  }
};

const CATEGORY_ORDER: DependencyCheck['category'][] = ['cli', 'runtime', 'per-extension'];

const ICON_BY_STATE: Record<DependencyStatus['state'], string> = {
  ok: 'check',
  warn: 'warning',
  fail: 'error',
  unknown: 'question'
};

const COLOR_BY_STATE: Record<DependencyStatus['state'], string | undefined> = {
  ok: 'testing.iconPassed',
  warn: 'editorWarning.foreground',
  fail: 'editorError.foreground',
  unknown: undefined
};

/**
 * Known ids for checks that render extra badges in the tree. Kept
 * separate from the generic `CheckNode` logic so adding a new one is
 * a local change.
 */
const SF_CLI_CHECK_ID = 'builtin.sf-cli';

export class DependenciesTreeProvider implements vscode.TreeDataProvider<DependenciesNode> {
  private readonly emitter = new vscode.EventEmitter<DependenciesNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private statuses = new Map<string, DependencyStatus>();
  private running = false;
  private cliLatestVersion: string | undefined;

  constructor(private readonly registry: DependencyRegistry) {}

  /**
   * Feeds the tree the latest `sf` CLI version (from
   * `CliVersionService`) so the Salesforce CLI row can render an
   * "update available" badge when the installed version is older.
   * Undefined turns the badge off. Tree re-renders on change.
   */
  setCliLatestVersion(version: string | undefined): void {
    if (this.cliLatestVersion === version) return;
    this.cliLatestVersion = version;
    this.refresh();
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  /** Runs every check, stores the results, and refreshes the tree. */
  async runChecks(): Promise<Map<string, DependencyStatus>> {
    if (this.running) return this.statuses;
    this.running = true;
    try {
      // Clear the cached check list so an extension that got uninstalled
      // mid-session (e.g. a Lightning apply that removed Apex) stops
      // contributing its shim/manifest deps on the very next run.
      this.registry.clearCache();
      this.statuses = await this.registry.runAll();
      // Drop statuses for checks that are no longer in the collected
      // set so the tree doesn't render orphaned rows.
      const live = new Set((await this.registry.collect()).map(c => c.id));
      for (const id of Array.from(this.statuses.keys())) {
        if (!live.has(id)) this.statuses.delete(id);
      }
      this.refresh();
      return this.statuses;
    } finally {
      this.running = false;
    }
  }

  /** Re-runs a single check by id and refreshes. */
  async runOne(id: string): Promise<void> {
    const status = await this.registry.runOne(id);
    this.statuses.set(id, status);
    this.refresh();
  }

  getStatuses(): ReadonlyMap<string, DependencyStatus> {
    return this.statuses;
  }

  getTreeItem(node: DependenciesNode): vscode.TreeItem {
    if (node.kind === 'category') {
      const item = new vscode.TreeItem(
        categoryLabel(node.category),
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = `${node.checks.length}`;
      item.contextValue = `category:${node.category}`;
      item.iconPath = new vscode.ThemeIcon(
        node.category === 'cli' ? 'terminal' : node.category === 'runtime' ? 'server' : 'extensions'
      );
      return item;
    }

    const status = node.status;
    const item = new vscode.TreeItem(node.check.label, vscode.TreeItemCollapsibleState.None);
    const cliUpdateAvailable = this.hasCliUpdate(node.check, status);
    const detail =
      status.state === 'unknown'
        ? getLocalization(LocalizationKeys.depStateNotRunYet)
        : status.version
          ? status.version
          : status.detail
            ? status.detail
            : status.state;
    item.description = cliUpdateAvailable
      ? getLocalization(LocalizationKeys.depCliUpdateBadge, detail, this.cliLatestVersion ?? '')
      : detail;
    const colorId = COLOR_BY_STATE[status.state];
    item.iconPath =
      // Update-available wins over the pass/fail icon so the "hey,
      // something to do" signal is visible at a glance. Only applies
      // when the check itself passed; a failing CLI row stays red.
      cliUpdateAvailable && status.state === 'ok'
        ? new vscode.ThemeIcon('arrow-circle-up', new vscode.ThemeColor('editorInfo.foreground'))
        : colorId
          ? new vscode.ThemeIcon(ICON_BY_STATE[status.state], new vscode.ThemeColor(colorId))
          : new vscode.ThemeIcon(ICON_BY_STATE[status.state]);
    const tooltipLines = [node.check.label];
    if (status.detail) tooltipLines.push(status.detail);
    if (cliUpdateAvailable) {
      tooltipLines.push(
        getLocalization(
          LocalizationKeys.depCliUpdateTooltip,
          status.version ?? '',
          this.cliLatestVersion ?? ''
        )
      );
    }
    const owners =
      node.check.ownerExtensionIds && node.check.ownerExtensionIds.length > 0
        ? node.check.ownerExtensionIds
        : node.check.ownerExtensionId
          ? [node.check.ownerExtensionId]
          : [];
    if (owners.length > 0) {
      tooltipLines.push(getLocalization(LocalizationKeys.depRequiredBy, owners.join(', ')));
    }
    if (node.check.remediation) {
      tooltipLines.push(getLocalization(LocalizationKeys.depFixLabel, node.check.remediation));
    }
    if (node.check.remediationUrl) tooltipLines.push(node.check.remediationUrl);
    item.tooltip = tooltipLines.join('\n');
    // Append `:sfCliUpdate` so the view/item/context menu can gate an
    // "Upgrade Salesforce CLI" entry on the exact same boundary
    // conditions the badge respects. Keeps the status bar, badge,
    // and menu entry all in agreement.
    const base = node.check.remediationUrl ? 'check:withRemediationUrl' : 'check';
    item.contextValue = cliUpdateAvailable ? `${base}:sfCliUpdate` : base;
    return item;
  }

  /**
   * True when this row is the Salesforce CLI check, the check ran
   * successfully, we parsed its installed version, we have a latest
   * version cached, and the latest is strictly newer. Any missing
   * piece suppresses the badge so offline / first-run / fresh-
   * install paths stay quiet.
   */
  private hasCliUpdate(check: DependencyCheck, status: DependencyStatus): boolean {
    if (check.id !== SF_CLI_CHECK_ID) return false;
    if (status.state !== 'ok') return false;
    if (!status.version || !this.cliLatestVersion) return false;
    return compare(status.version, this.cliLatestVersion) < 0;
  }

  /**
   * Returns the installed + latest versions of the Salesforce CLI
   * when an upgrade is available; `undefined` otherwise. Used by
   * the status-bar item + the row-level "Upgrade Salesforce CLI"
   * action to render consistently with the badge.
   */
  getCliUpdateInfo(): { installed: string; latest: string } | undefined {
    const status = this.statuses.get(SF_CLI_CHECK_ID);
    if (!status || status.state !== 'ok' || !status.version) return undefined;
    if (!this.cliLatestVersion) return undefined;
    if (compare(status.version, this.cliLatestVersion) >= 0) return undefined;
    return { installed: status.version, latest: this.cliLatestVersion };
  }

  async getChildren(parent?: DependenciesNode): Promise<DependenciesNode[]> {
    const checks = await this.registry.collect();
    if (!parent) {
      return CATEGORY_ORDER.filter(cat => checks.some(c => c.category === cat)).map(cat => ({
        kind: 'category' as const,
        category: cat,
        checks: checks.filter(c => c.category === cat)
      }));
    }
    if (parent.kind !== 'category') return [];
    return parent.checks.map(check => ({
      kind: 'check' as const,
      check,
      status: this.statuses.get(check.id) ?? { state: 'unknown' }
    }));
  }
}

/**
 * Formats the current status map as a markdown report suitable for clipboard
 * paste or sharing in a bug report.
 */
export const formatReport = (
  checks: DependencyCheck[],
  statuses: ReadonlyMap<string, DependencyStatus>
): string => {
  const lines: string[] = ['# Salesforce Extensions Manager — Dependency Report', ''];
  for (const cat of CATEGORY_ORDER) {
    const inCat = checks.filter(c => c.category === cat);
    if (inCat.length === 0) continue;
    lines.push(`## ${categoryLabel(cat)}`, '');
    for (const c of inCat) {
      const s = statuses.get(c.id) ?? { state: 'unknown' };
      const badge = s.state === 'ok' ? 'OK' : s.state === 'warn' ? 'WARN' : s.state === 'fail' ? 'FAIL' : '—';
      const ver = s.version ? ` (${s.version})` : '';
      const detail = s.detail ? ` — ${s.detail}` : '';
      lines.push(`- **${c.label}**: ${badge}${ver}${detail}`);
      if (c.ownerExtensionId) lines.push(`  - required by \`${c.ownerExtensionId}\``);
      if ((s.state === 'fail' || s.state === 'warn') && c.remediation) {
        lines.push(`  - fix: ${c.remediation}${c.remediationUrl ? ` (${c.remediationUrl})` : ''}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
};
