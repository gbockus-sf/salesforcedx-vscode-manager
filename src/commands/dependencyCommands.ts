import * as vscode from 'vscode';
import { COMMANDS, VIEW_DEPENDENCIES_ID } from '../constants';
import type { DependencyRegistry } from '../dependencies/registry';
import { getLocalization, LocalizationKeys } from '../localization';
import type { CliVersionService } from '../services/cliVersionService';
import { TelemetryService } from '../services/telemetryService';
import type { Logger } from '../util/logger';
import {
  DependenciesTreeProvider,
  formatReport
} from '../views/dependenciesTreeProvider';

interface Deps {
  registry: DependencyRegistry;
  tree: DependenciesTreeProvider;
  logger: Logger;
  /**
   * Injected so `upgradeCli` can clear the cached "update available"
   * answer + kick a fresh probe once the user closes the terminal
   * the upgrade ran in. Optional for tests that don't care about
   * the refresh hook.
   */
  cliVersion?: CliVersionService;
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
        {
          location: { viewId: VIEW_DEPENDENCIES_ID },
          title: getLocalization(LocalizationKeys.depsProgressTitle)
        },
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
          TelemetryService.sendDependencyCheck(counts);
          // Only notify when something is actionable. If every row is
          // green the Dependencies tree already speaks for itself — no
          // toast. On fail/warn/unknown attach a "Show Dependencies"
          // action so the toast leads somewhere useful.
          if (counts.fail === 0 && counts.warn === 0 && counts.unknown === 0) return;
          const showAction = getLocalization(LocalizationKeys.depsShowAction);
          const summary = getLocalization(LocalizationKeys.depsSummary, parts.join(' · '));
          void vscode.window.showWarningMessage(summary, showAction).then(pick => {
            if (pick === showAction) {
              void vscode.commands.executeCommand(`${VIEW_DEPENDENCIES_ID}.focus`);
            }
          });
        }
      );
    }),

    vscode.commands.registerCommand(COMMANDS.copyDependencyReport, async () => {
      const checks = await deps.registry.collect();
      const report = formatReport(checks, deps.tree.getStatuses());
      await vscode.env.clipboard.writeText(report);
      // Success toast suppressed: the user just triggered the copy; the
      // clipboard is the feedback. Log for the trail.
      deps.logger.info(`Dependency report copied to clipboard (${report.length} chars).`);
    }),

    vscode.commands.registerCommand('sfdxManager.openRemediationUrl', async (arg?: CheckTreeContext) => {
      const url = arg?.check?.remediationUrl;
      if (!url) return;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand(COMMANDS.upgradeCli, async () => {
      // Run `sf update` inside a dedicated terminal so the user sees
      // progress output as it happens. We don't try to infer the
      // install strategy (npm / brew / installer) — `sf update` is
      // the official self-upgrade path for most distributions, and
      // if the user's setup needs something else the terminal
      // output will say so.
      const terminal = vscode.window.createTerminal({
        name: getLocalization(LocalizationKeys.upgradeCliTerminalName)
      });
      terminal.show();
      terminal.sendText('sf update');
      deps.logger.info('upgradeCli: launched `sf update` in a dedicated terminal.');

      // Once the user closes our upgrade terminal (normally after
      // watching it finish), assume the upgrade landed and re-probe:
      //   1. clear the cached "update available" answer so
      //      CliVersionService re-runs `sf version`,
      //   2. re-run the Salesforce CLI dep check so the row's
      //      installed version re-parses.
      // The tree badge + status-bar item both key off those two
      // data sources, so they clear automatically.
      const sub = vscode.window.onDidCloseTerminal(async closed => {
        if (closed !== terminal) return;
        sub.dispose();
        deps.cliVersion?.clearCache();
        const latest = await deps.cliVersion?.getLatestVersion();
        deps.tree.setCliLatestVersion(latest);
        await deps.tree.runOne('builtin.sf-cli');
        deps.logger.info('upgradeCli: terminal closed; CLI version info refreshed.');
      });
    }),

    vscode.commands.registerCommand(COMMANDS.refreshCliVersion, async () => {
      // Manual escape hatch — handy if the user ran `sf update`
      // outside our terminal, or wants to confirm the state after
      // editing PATH.
      deps.cliVersion?.clearCache();
      const latest = await deps.cliVersion?.getLatestVersion();
      deps.tree.setCliLatestVersion(latest);
      await deps.tree.runOne('builtin.sf-cli');
      deps.logger.info('refreshCliVersion: CLI version info refreshed.');
    })
  );
};
