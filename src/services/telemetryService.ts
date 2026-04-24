import * as vscode from 'vscode';
import { ServiceProvider, ServiceType } from '@salesforce/vscode-service-provider';
import type { TelemetryServiceInterface } from '@salesforce/vscode-service-provider';
import { EXTENSION_ID } from '../constants';
import type { Logger } from '../util/logger';

/**
 * Public event-name constants. Kept together so the taxonomy is a single
 * grep away. Every event is prefixed `sfdxManager_` so downstream
 * dashboards can filter the manager's events from core's.
 */
const EVENT = {
  activation: 'sfdxManager_activation',
  deactivation: 'sfdxManager_deactivation',
  groupApply: 'sfdxManager_group_apply',
  extensionInstall: 'sfdxManager_extension_install',
  extensionUninstall: 'sfdxManager_extension_uninstall',
  extensionUpdate: 'sfdxManager_extension_update',
  catalogRefresh: 'sfdxManager_catalog_refresh',
  dependencyCheck: 'sfdxManager_dependency_check',
  error: 'sfdxManager_error'
} as const;

type Properties = Record<string, string>;
type Measurements = Record<string, number>;

/**
 * Singleton owning the extension's connection to the core telemetry
 * reporter. Call `init(context, logger)` once from `activate()`, then use
 * the typed emit helpers anywhere. Helpers are safe no-ops when the
 * reporter is unavailable (core missing / wedged) or when the shared
 * telemetry service decides not to send — `telemetry.telemetryLevel`
 * and whatever else core gates on are handled downstream by the
 * `ServiceProvider` pipeline, so we don't duplicate that logic here.
 *
 * The no-op behavior is load-bearing: the manager extension must stay
 * functional when telemetry is unavailable for any reason. Throwing out
 * of telemetry helpers would regress user-facing commands.
 */
export class TelemetryService {
  private static reporter: TelemetryServiceInterface | undefined;
  private static logger: Logger | undefined;

  static async init(context: vscode.ExtensionContext, logger?: Logger): Promise<void> {
    TelemetryService.logger = logger;
    try {
      const reporter = await ServiceProvider.getService(ServiceType.Telemetry, EXTENSION_ID);
      await reporter.initializeService(context);
      TelemetryService.reporter = reporter;
      logger?.info('TelemetryService: acquired core telemetry reporter.');
    } catch (err) {
      // Log but never throw — the extension must activate even when
      // telemetry is unavailable.
      TelemetryService.reporter = undefined;
      const message = err instanceof Error ? err.message : String(err);
      logger?.warn(`TelemetryService: reporter unavailable (${message}); events will no-op.`);
    }
  }

  static sendActivation(hrStart: [number, number]): void {
    if (!TelemetryService.canSend()) return;
    TelemetryService.reporter?.sendExtensionActivationEvent(hrStart);
  }

  static sendDeactivation(): void {
    if (!TelemetryService.canSend()) return;
    TelemetryService.reporter?.sendCommandEvent(EVENT.deactivation, undefined, {}, {});
  }

  static sendGroupApply(args: {
    groupId: string;
    source: string; // 'code' | 'pack' | 'catalog' | 'user'
    scope: string;  // 'disableOthers' | 'enableOnly' | 'ask'
    enabled: number;
    disabled: number;
    depBlocked: number;
    manualEnable: number;
    manualDisable: number;
    skipped: number;
    installedFromVsix: number;
  }): void {
    if (!TelemetryService.canSend()) return;
    const properties: Properties = {
      groupId: args.groupId,
      source: args.source,
      scope: args.scope
    };
    const measurements: Measurements = {
      enabled: args.enabled,
      disabled: args.disabled,
      depBlocked: args.depBlocked,
      manualEnable: args.manualEnable,
      manualDisable: args.manualDisable,
      skipped: args.skipped,
      installedFromVsix: args.installedFromVsix
    };
    TelemetryService.reporter?.sendCommandEvent(EVENT.groupApply, undefined, properties, measurements);
  }

  static sendExtensionOp(
    op: 'install' | 'uninstall' | 'update',
    args: {
      extensionId: string;
      source: 'marketplace' | 'vsix' | 'unknown';
      exitCode: number;
    }
  ): void {
    if (!TelemetryService.canSend()) return;
    const eventName =
      op === 'install'
        ? EVENT.extensionInstall
        : op === 'uninstall'
          ? EVENT.extensionUninstall
          : EVENT.extensionUpdate;
    const properties: Properties = {
      extensionId: args.extensionId,
      source: args.source
    };
    const measurements: Measurements = {
      exitCode: args.exitCode
    };
    TelemetryService.reporter?.sendCommandEvent(eventName, undefined, properties, measurements);
  }

  static sendCatalogRefresh(args: { entryCount: number; durationMs: number }): void {
    if (!TelemetryService.canSend()) return;
    TelemetryService.reporter?.sendCommandEvent(
      EVENT.catalogRefresh,
      undefined,
      {},
      { entryCount: args.entryCount, durationMs: args.durationMs }
    );
  }

  static sendDependencyCheck(args: {
    ok: number;
    warn: number;
    fail: number;
    unknown: number;
  }): void {
    if (!TelemetryService.canSend()) return;
    TelemetryService.reporter?.sendCommandEvent(
      EVENT.dependencyCheck,
      undefined,
      {},
      { ok: args.ok, warn: args.warn, fail: args.fail, unknown: args.unknown }
    );
  }

  static sendError(err: unknown, args: { commandId: string }): void {
    if (!TelemetryService.canSend()) return;
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error && err.name ? err.name : 'Error';
    TelemetryService.reporter?.sendException(`${args.commandId}:${name}`, message);
  }

  static dispose(): void {
    // The core telemetry pipeline owns the reporter lifecycle; we just
    // drop the reference so any stray helper call becomes a no-op.
    TelemetryService.reporter = undefined;
  }

  /** Exposed for tests only. */
  static __resetForTests(): void {
    TelemetryService.reporter = undefined;
    TelemetryService.logger = undefined;
  }

  /** Exposed for tests only. */
  static __setReporterForTests(reporter: TelemetryServiceInterface | undefined): void {
    TelemetryService.reporter = reporter;
  }

  private static canSend(): boolean {
    return TelemetryService.reporter !== undefined;
  }
}
