import * as vscode from 'vscode';
import { ExtensionService, VsixInstallerLike } from '../../src/services/extensionService';
import { SettingsService } from '../../src/services/settingsService';
import { CodeCliService } from '../../src/services/codeCliService';
import { Logger } from '../../src/util/logger';

const makeExt = (id: string, pkg: Record<string, unknown> = {}): vscode.Extension<unknown> =>
  ({ id, packageJSON: pkg } as unknown as vscode.Extension<unknown>);

describe('ExtensionService', () => {
  const mkSettings = (overrides: Partial<Record<keyof SettingsService, unknown>> = {}): SettingsService => ({
    getThirdPartyExtensionIds: jest.fn(() => ['redhat.vscode-xml']),
    getUseInternalCommands: jest.fn(() => true),
    ...overrides
  } as unknown as SettingsService);

  const mkCodeCli = (): CodeCliService => ({
    installExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    uninstallExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
  } as unknown as CodeCliService);

  const mkLogger = (): Logger => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), dispose: jest.fn()
  } as unknown as Logger);

  beforeEach(() => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
    (vscode.extensions.getExtension as jest.Mock).mockReset();
    (vscode.commands.executeCommand as jest.Mock).mockReset();
  });

  it('managed() returns salesforce publisher + listed third parties', () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
      makeExt('salesforce.salesforcedx-vscode-core'),
      makeExt('redhat.vscode-xml'),
      makeExt('someone.unrelated')
    ];
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    expect(svc.managed().map(e => e.id)).toEqual([
      'salesforce.salesforcedx-vscode-core',
      'redhat.vscode-xml'
    ]);
  });

  it('enable() invokes the internal workbench command when setting allows', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(makeExt('salesforce.foo'));
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    await svc.enable('salesforce.foo');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.extensions.action.enableExtension',
      'salesforce.foo'
    );
  });

  it('enable() falls back to the extensions-view deep link when setting is false', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(makeExt('salesforce.foo'));
    const svc = new ExtensionService(
      mkSettings({ getUseInternalCommands: jest.fn(() => false) } as Partial<Record<keyof SettingsService, unknown>>),
      mkCodeCli(),
      mkLogger()
    );
    await svc.enable('salesforce.foo');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.extensions.search',
      '@installed salesforce.foo'
    );
  });

  it('enable() falls back when the internal command throws', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(makeExt('salesforce.foo'));
    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async (cmd: string) => {
      if (cmd === 'workbench.extensions.action.enableExtension') throw new Error('not available');
    });
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    await svc.enable('salesforce.foo');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.extensions.search',
      '@installed salesforce.foo'
    );
  });

  it('enable() short-circuits when the extension is not installed', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    const logger = mkLogger();
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), logger);
    await svc.enable('salesforce.missing');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('install() routes through VsixInstaller when a local vsix matches', async () => {
    const vsix: VsixInstallerLike = { tryInstall: jest.fn(async () => 'vsix') };
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    svc.setVsixInstaller(vsix);
    const result = await svc.install('salesforce.foo');
    expect(result.source).toBe('vsix');
    expect(cli.installExtension).not.toHaveBeenCalled();
  });

  it('install() falls through to the marketplace when the VsixInstaller says skipped', async () => {
    const vsix: VsixInstallerLike = { tryInstall: jest.fn(async () => 'skipped') };
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    svc.setVsixInstaller(vsix);
    const result = await svc.install('salesforce.foo');
    expect(result.source).toBe('marketplace');
    expect(cli.installExtension).not.toHaveBeenCalled();
  });

  it('install() uses the marketplace CLI when no VsixInstaller is wired up', async () => {
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const result = await svc.install('salesforce.foo');
    expect(result.source).toBe('marketplace');
    expect(cli.installExtension).toHaveBeenCalledWith('salesforce.foo');
  });

  it('uninstall() delegates to the code CLI', async () => {
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    await svc.uninstall('salesforce.foo');
    expect(cli.uninstallExtension).toHaveBeenCalledWith('salesforce.foo');
  });

  it('readManifest() returns the packageJSON of an installed extension without activating it', () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { name: 'foo', salesforceDependencies: [{ id: 'java' }] })
    );
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    expect(svc.readManifest('salesforce.foo')).toEqual({
      name: 'foo',
      salesforceDependencies: [{ id: 'java' }]
    });
  });
});
