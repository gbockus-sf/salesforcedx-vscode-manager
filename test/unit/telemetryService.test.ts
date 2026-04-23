/**
 * Unit coverage for src/services/telemetryService.ts.
 *
 * The reporter comes from `@salesforce/vscode-service-provider`'s
 * `ServiceProvider.getService(ServiceType.Telemetry, ...)`. We mock that
 * module to control the two pivots the service cares about:
 *   - Reporter acquired successfully → typed emit helpers call through.
 *   - Reporter acquisition throws → helpers no-op silently.
 *
 * We also verify the `telemetry.enabled` setting flips every helper to
 * no-op even when the reporter is healthy.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as vscode from 'vscode';

const mockReporter = {
  initializeService: jest.fn(async () => undefined),
  sendCommandEvent: jest.fn(),
  sendException: jest.fn(),
  sendExtensionActivationEvent: jest.fn(),
  isTelemetryEnabled: jest.fn(async () => true),
  getReporters: jest.fn(() => [])
};

const getServiceMock = jest.fn<Promise<typeof mockReporter>, unknown[]>(async () => mockReporter);

jest.mock('@salesforce/vscode-service-provider', () => ({
  ServiceProvider: {
    getService: jest.fn((_type: unknown, _id: unknown) => getServiceMock(_type, _id))
  },
  ServiceType: {
    Telemetry: 'Telemetry'
  }
}));

// Has to be imported AFTER jest.mock so the mock takes effect.
import { TelemetryService } from '../../src/services/telemetryService';

const mkContext = (): vscode.ExtensionContext =>
  ({ subscriptions: [] } as unknown as vscode.ExtensionContext);

describe('TelemetryService', () => {
  beforeEach(() => {
    TelemetryService.__resetForTests();
    getServiceMock.mockReset();
    Object.values(mockReporter).forEach((fn: any) => {
      if (fn.mockReset) fn.mockReset();
    });
    mockReporter.initializeService.mockImplementation(async () => undefined);
    mockReporter.isTelemetryEnabled.mockImplementation(async () => true);
    getServiceMock.mockImplementation(async () => mockReporter);
    // Default settings mock returns undefined → treated as "telemetry enabled"
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn(() => true)
    });
  });

  it('init acquires the reporter and calls initializeService', async () => {
    await TelemetryService.init(mkContext());
    expect(getServiceMock).toHaveBeenCalled();
    expect(mockReporter.initializeService).toHaveBeenCalled();
  });

  it('emit helpers forward to the reporter when init succeeded', async () => {
    await TelemetryService.init(mkContext());
    TelemetryService.sendGroupApply({
      groupId: 'apex',
      source: 'code',
      scope: 'disableOthers',
      enabled: 3,
      disabled: 2,
      depBlocked: 1,
      manualEnable: 0,
      manualDisable: 0,
      skipped: 0,
      installedFromVsix: 0
    });
    expect(mockReporter.sendCommandEvent).toHaveBeenCalledTimes(1);
    const [name, , props, meas] = mockReporter.sendCommandEvent.mock.calls[0];
    expect(name).toBe('sfdxManager_group_apply');
    expect(props).toMatchObject({ groupId: 'apex', source: 'code', scope: 'disableOthers' });
    expect(meas).toMatchObject({ enabled: 3, disabled: 2, depBlocked: 1 });
  });

  it('every helper is a silent no-op when reporter acquisition throws', async () => {
    getServiceMock.mockImplementationOnce(async () => {
      throw new Error('core not installed');
    });
    await TelemetryService.init(mkContext());
    expect(() => {
      TelemetryService.sendActivation([0, 0]);
      TelemetryService.sendGroupApply({
        groupId: 'apex',
        source: 'code',
        scope: 'disableOthers',
        enabled: 0,
        disabled: 0,
        depBlocked: 0,
        manualEnable: 0,
        manualDisable: 0,
        skipped: 0,
        installedFromVsix: 0
      });
      TelemetryService.sendExtensionOp('install', {
        extensionId: 'salesforce.foo',
        source: 'marketplace',
        exitCode: 0
      });
      TelemetryService.sendCatalogRefresh({ entryCount: 10, durationMs: 100 });
      TelemetryService.sendDependencyCheck({ ok: 4, warn: 0, fail: 0, unknown: 0 });
      TelemetryService.sendError(new Error('boom'), { commandId: 'sfdxManager.foo' });
    }).not.toThrow();
    expect(mockReporter.sendCommandEvent).not.toHaveBeenCalled();
    expect(mockReporter.sendException).not.toHaveBeenCalled();
    expect(mockReporter.sendExtensionActivationEvent).not.toHaveBeenCalled();
  });

  it('every helper is a no-op when telemetry.enabled=false even with a healthy reporter', async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn(() => false)
    });
    await TelemetryService.init(mkContext());
    TelemetryService.sendActivation([0, 0]);
    TelemetryService.sendCatalogRefresh({ entryCount: 10, durationMs: 100 });
    TelemetryService.sendExtensionOp('uninstall', {
      extensionId: 'salesforce.foo',
      source: 'marketplace',
      exitCode: 0
    });
    expect(mockReporter.sendCommandEvent).not.toHaveBeenCalled();
    expect(mockReporter.sendExtensionActivationEvent).not.toHaveBeenCalled();
  });

  it('refreshEnabled picks up a setting flip without re-initializing the reporter', async () => {
    const getMock = jest.fn(() => true);
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: getMock });
    await TelemetryService.init(mkContext());
    TelemetryService.sendActivation([0, 0]);
    expect(mockReporter.sendExtensionActivationEvent).toHaveBeenCalledTimes(1);
    // User flips telemetry.enabled off, config.onDidChange handler runs.
    getMock.mockReturnValue(false);
    TelemetryService.refreshEnabled();
    TelemetryService.sendActivation([0, 0]);
    expect(mockReporter.sendExtensionActivationEvent).toHaveBeenCalledTimes(1);
  });

  it('sendError routes exceptions to sendException with commandId:name namespacing', async () => {
    await TelemetryService.init(mkContext());
    class CustomErr extends Error {
      constructor() {
        super('oops');
        this.name = 'CustomErr';
      }
    }
    TelemetryService.sendError(new CustomErr(), { commandId: 'sfdxManager.applyGroup' });
    expect(mockReporter.sendException).toHaveBeenCalledWith(
      'sfdxManager.applyGroup:CustomErr',
      'oops'
    );
  });

  it('dispose drops the reporter reference so subsequent helpers no-op', async () => {
    await TelemetryService.init(mkContext());
    TelemetryService.dispose();
    TelemetryService.sendActivation([0, 0]);
    expect(mockReporter.sendExtensionActivationEvent).not.toHaveBeenCalled();
  });
});
