import * as vscode from 'vscode';
import { COMMANDS, VIEW_DEPENDENCIES_ID } from '../constants';
import type { DependencyRegistry } from '../dependencies/registry';
import type { Logger } from '../util/logger';
import {
  DependenciesTreeProvider,
  formatReport
} from '../views/dependenciesTreeProvider';

interface Deps {
  registry: DependencyRegistry;
  tree: DependenciesTreeProvider;
  logger: Logger;
}

interface CheckTreeContext {
  kind?: 'check';
  check?: { id: string; remediationUrl?: string };
}

export const registerDependencyCommands = (
  context: vscode.ExtensionContext,
  deps: Deps
): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.showDependencies, async () => {
      await vscode.commands.executeCommand(`${VIEW_DEPENDENCIES_ID}.focus`);
    }),

    vscode.commands.registerCommand(COMMANDS.runDependencyCheck, async (arg?: CheckTreeContext) => {
      if (arg?.check?.id) {
        await deps.tree.runOne(arg.check.id);
        return;
      }
      await vscode.window.withProgress(
        { location: { viewId: VIEW_DEPENDENCIES_ID }, title: 'Checking dependencies…' },
        async () => {
          const statuses = await deps.tree.runChecks();
          const counts = { ok: 0, warn: 0, fail: 0, unknown: 0 };
          for (const s of statuses.values()) counts[s.state]++;
          const parts: string[] = [];
          if (counts.ok) parts.push(`${counts.ok} ok`);
          if (counts.warn) parts.push(`${counts.warn} warn`);
          if (counts.fail) parts.push(`${counts.fail} fail`);
          if (counts.unknown) parts.push(`${counts.unknown} unknown`);
          deps.logger.info(`Dependency check complete: ${parts.join(', ') || 'no checks registered'}`);
          if (counts.fail > 0) {
            void vscode.window.showWarningMessage(`Dependencies: ${parts.join(' · ')}`);
          } else {
            void vscode.window.showInformationMessage(`Dependencies: ${parts.join(' · ')}`);
          }
        }
      );
    }),

    vscode.commands.registerCommand(COMMANDS.copyDependencyReport, async () => {
      const checks = await deps.registry.collect();
      const report = formatReport(checks, deps.tree.getStatuses());
      await vscode.env.clipboard.writeText(report);
      void vscode.window.showInformationMessage('Dependency report copied to clipboard.');
    }),

    vscode.commands.registerCommand('sfdxManager.openRemediationUrl', async (arg?: CheckTreeContext) => {
      const url = arg?.check?.remediationUrl;
      if (!url) return;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );
};
