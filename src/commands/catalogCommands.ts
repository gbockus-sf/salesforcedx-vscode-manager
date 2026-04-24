import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import { getLocalization, LocalizationKeys } from '../localization';
import { BUSY_SENTINELS, type BusyState } from '../util/busyState';
import { notifyInfo, notifyWarn } from '../util/notify';
import type { ExtensionService } from '../services/extensionService';
import type { PublisherCatalogService } from '../services/publisherCatalogService';
import { TelemetryService } from '../services/telemetryService';
import type { Logger } from '../util/logger';
import type { GroupsTreeProvider } from '../views/groupsTreeProvider';

interface Deps {
  catalog: PublisherCatalogService;
  extensions: ExtensionService;
  logger: Logger;
  tree: GroupsTreeProvider;
  busy?: BusyState;
}

const withBusy = async <T>(
  deps: Deps,
  ids: readonly string[],
  fn: () => Promise<T>
): Promise<T> => (deps.busy ? deps.busy.withBusy(ids, fn) : fn());

export const registerCatalogCommands = (
  context: vscode.ExtensionContext,
  deps: Deps
): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.refreshSalesforceCatalog, async () => {
      const startMs = Date.now();
      await deps.catalog.refresh({ force: true });
      const entries = deps.catalog.current();
      deps.tree.refresh();
      TelemetryService.sendCatalogRefresh({
        entryCount: entries.length,
        durationMs: Date.now() - startMs
      });
      // Success: the catalog group re-renders with the new member count —
      // no toast. Empty result usually means offline / auth failure; users
      // need to know that.
      if (entries.length === 0) {
        void notifyWarn(getLocalization(LocalizationKeys.refreshCatalogEmpty), {
          logger: deps.logger
        });
      } else {
        deps.logger.info(`publisherCatalog: refreshed; ${entries.length} extensions.`);
      }
    }),

    vscode.commands.registerCommand(COMMANDS.browseSalesforceExtensions, async () => {
      // Lazy-refresh if the snapshot is empty AND the user didn't opt out.
      if (deps.catalog.current().length === 0) {
        await deps.catalog.refresh();
      }
      const entries = deps.catalog.current();
      if (entries.length === 0) {
        void notifyInfo(getLocalization(LocalizationKeys.browseEmpty), { logger: deps.logger });
        return;
      }
      const installedIds = new Set(deps.extensions.managed().map(e => e.id));
      const picks = await vscode.window.showQuickPick(
        entries.map(entry => {
          const alreadyInstalled = installedIds.has(entry.extensionId);
          const installLabel =
            entry.installCount !== undefined
              ? `${formatCount(entry.installCount)} installs`
              : undefined;
          const tags = [installLabel, alreadyInstalled ? 'installed' : undefined].filter(
            (v): v is string => !!v
          );
          return {
            label: entry.displayName,
            description: entry.extensionId,
            detail: [entry.shortDescription, tags.length ? `(${tags.join(' · ')})` : undefined]
              .filter((v): v is string => !!v)
              .join(' '),
            picked: false,
            extensionId: entry.extensionId
          };
        }),
        {
          canPickMany: true,
          matchOnDescription: true,
          matchOnDetail: true,
          placeHolder: getLocalization(LocalizationKeys.browsePlaceholder)
        }
      );
      if (!picks || picks.length === 0) return;
      const pickedIds = picks.map(p => p.extensionId);
      await withBusy(deps, [BUSY_SENTINELS.browseInstall, ...pickedIds], async () => {
        let ok = 0;
        let failed = 0;
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: getLocalization(LocalizationKeys.browseInstallProgress)
          },
          async progress => {
            for (const pick of picks) {
              progress.report({ message: deps.extensions.label(pick.extensionId) });
              const result = await deps.extensions.install(pick.extensionId);
              if (result.exitCode === 0) ok++;
              else {
                failed++;
                deps.logger.warn(
                  `browse: install ${pick.extensionId} exit ${result.exitCode} ${result.stderr ?? ''}`
                );
              }
            }
          }
        );
        deps.tree.refresh();
        if (failed > 0) {
          void notifyWarn(
            getLocalization(LocalizationKeys.browseInstallSummaryFailed, ok, failed),
            { logger: deps.logger }
          );
        } else {
          // Success: tree already shows the new installed rows.
          deps.logger.info(`browse: installed ${ok} extension(s).`);
        }
      });
    })
  );
};

const formatCount = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
};
