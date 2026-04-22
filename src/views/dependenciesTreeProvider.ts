import * as vscode from 'vscode';
import type { DependencyRegistry } from '../dependencies/registry';
import type { DependencyCheck, DependencyStatus } from '../dependencies/types';

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

const CATEGORY_LABEL: Record<DependencyCheck['category'], string> = {
  cli: 'CLIs',
  runtime: 'Runtimes',
  'per-extension': 'Per-Extension'
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

export class DependenciesTreeProvider implements vscode.TreeDataProvider<DependenciesNode> {
  private readonly emitter = new vscode.EventEmitter<DependenciesNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private statuses = new Map<string, DependencyStatus>();
  private running = false;

  constructor(private readonly registry: DependencyRegistry) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  /** Runs every check, stores the results, and refreshes the tree. */
  async runChecks(): Promise<Map<string, DependencyStatus>> {
    if (this.running) return this.statuses;
    this.running = true;
    try {
      this.statuses = await this.registry.runAll();
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
        CATEGORY_LABEL[node.category],
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
    const detail =
      status.state === 'unknown'
        ? 'not run yet'
        : status.version
          ? status.version
          : status.detail
            ? status.detail
            : status.state;
    item.description = detail;
    const colorId = COLOR_BY_STATE[status.state];
    item.iconPath = colorId
      ? new vscode.ThemeIcon(ICON_BY_STATE[status.state], new vscode.ThemeColor(colorId))
      : new vscode.ThemeIcon(ICON_BY_STATE[status.state]);
    const tooltipLines = [node.check.label];
    if (status.detail) tooltipLines.push(status.detail);
    if (node.check.ownerExtensionId) tooltipLines.push(`Required by: ${node.check.ownerExtensionId}`);
    if (node.check.remediation) tooltipLines.push(`Fix: ${node.check.remediation}`);
    if (node.check.remediationUrl) tooltipLines.push(node.check.remediationUrl);
    item.tooltip = tooltipLines.join('\n');
    item.contextValue = node.check.remediationUrl ? 'check:withRemediationUrl' : 'check';
    return item;
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
    lines.push(`## ${CATEGORY_LABEL[cat]}`, '');
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
