import * as vscode from 'vscode';
import {
  ExtensionService,
  MarketplaceVersionProbe,
  VsixInstallerLike,
  parseCliVersions
} from '../../src/services/extensionService';
import { SettingsService } from '../../src/services/settingsService';
import { CodeCliService } from '../../src/services/codeCliService';
import { Logger } from '../../src/util/logger';

const makeExt = (id: string, pkg: Record<string, unknown> = {}): vscode.Extension<unknown> =>
  ({ id, packageJSON: pkg } as unknown as vscode.Extension<unknown>);

describe('ExtensionService', () => {
  const mkSettings = (overrides: Partial<Record<keyof SettingsService, unknown>> = {}): SettingsService => ({
    getThirdPartyExtensionIds: jest.fn(() => ['redhat.vscode-xml']),
    getUseInternalCommands: jest.fn(() => true),
    getBackend: jest.fn(() => 'codeCli'),
    getUpdateCheck: jest.fn(() => 'manual' as const),
    ...overrides
  } as unknown as SettingsService);

  const mkCodeCli = (): CodeCliService => ({
    installExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    uninstallExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    listInstalledWithVersions: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
  } as unknown as CodeCliService);

  const mkLogger = (): Logger => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), dispose: jest.fn()
  } as unknown as Logger);

  beforeEach(() => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
    (vscode.extensions.getExtension as jest.Mock).mockReset();
    (vscode.commands.executeCommand as jest.Mock).mockReset();
    (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
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

  it('enable() is a no-op when the extension is already installed', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(makeExt('salesforce.foo'));
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.enable('salesforce.foo');
    expect(outcome).toBe('ok');
    expect(cli.installExtension).not.toHaveBeenCalled();
  });

  it('enable() installs via code CLI when the extension is missing', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.enable('salesforce.foo');
    expect(outcome).toBe('ok');
    expect(cli.installExtension).toHaveBeenCalledWith('salesforce.foo');
  });

  it('enable() returns manual-required when install fails', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    const cli = {
      installExtension: jest.fn(async () => ({ stdout: '', stderr: 'network', exitCode: 1 })),
      uninstallExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }))
    } as unknown as CodeCliService;
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.enable('salesforce.foo');
    expect(outcome).toBe('manual-required');
  });

  it('enable() returns manual-required when backend is not codeCli', async () => {
    const svc = new ExtensionService(
      mkSettings({ getBackend: jest.fn(() => 'profiles') } as Partial<Record<keyof SettingsService, unknown>>),
      mkCodeCli(),
      mkLogger()
    );
    const outcome = await svc.enable('salesforce.foo');
    expect(outcome).toBe('manual-required');
  });

  it('disable() uninstalls via the code CLI when the extension is installed', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(makeExt('salesforce.foo'));
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.disable('salesforce.foo');
    expect(outcome).toBe('ok');
    expect(cli.uninstallExtension).toHaveBeenCalledWith('salesforce.foo');
  });

  it('disable() is a no-op when the extension is not installed', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.disable('salesforce.foo');
    expect(outcome).toBe('ok');
    expect(cli.uninstallExtension).not.toHaveBeenCalled();
  });

  it('disable() reports manual-required when uninstall fails', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(makeExt('salesforce.foo'));
    const cli = {
      installExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
      uninstallExtension: jest.fn(async () => ({ stdout: '', stderr: 'err', exitCode: 1 }))
    } as unknown as CodeCliService;
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    const outcome = await svc.disable('salesforce.foo');
    expect(outcome).toBe('manual-required');
  });

  it('showManualToggleHint() opens the extensions view with a combined filter', async () => {
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    await svc.showManualToggleHint(['salesforce.a', 'salesforce.b'], 'Disable');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.extensions.search',
      '@installed salesforce.a @installed salesforce.b'
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
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

  it('install() surfaces a vsix failure when the VsixInstaller says skipped, without silently hitting marketplace', async () => {
    const vsix: VsixInstallerLike = { tryInstall: jest.fn(async () => 'skipped') };
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    svc.setVsixInstaller(vsix);
    const result = await svc.install('salesforce.foo');
    expect(result.source).toBe('vsix');
    expect(result.exitCode).not.toBe(0);
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

  it('getInstalledVersion() reads packageJSON.version statically', () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { version: '63.0.0' })
    );
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    expect(svc.getInstalledVersion('salesforce.foo')).toBe('63.0.0');
  });

  it('getInstalledVersion() returns undefined when the extension is not installed', () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    expect(svc.getInstalledVersion('salesforce.foo')).toBeUndefined();
  });

  it('install() with force passes --force to the code CLI', async () => {
    const cli = mkCodeCli();
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    await svc.install('salesforce.foo', { force: true });
    expect(cli.installExtension).toHaveBeenCalledWith('salesforce.foo', true);
  });

  it('getNodeVersionInfo() reports no update when there is no probe', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { version: '63.0.0' })
    );
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    const info = await svc.getNodeVersionInfo('salesforce.foo');
    expect(info.installedVersion).toBe('63.0.0');
    expect(info.latestVersion).toBeUndefined();
    expect(info.updateAvailable).toBe(false);
    expect(info.source).toBe('unknown');
  });

  it('getNodeVersionInfo() reports updateAvailable when the marketplace version is newer', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { version: '63.0.0' })
    );
    const probe: MarketplaceVersionProbe = {
      getLatestVersion: jest.fn(async () => '63.1.0'),
      clearCache: jest.fn()
    };
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    svc.setMarketplaceProbe(probe);
    svc.setInstallSourceLookup(() => 'marketplace');
    const info = await svc.getNodeVersionInfo('salesforce.foo');
    expect(info.installedVersion).toBe('63.0.0');
    expect(info.latestVersion).toBe('63.1.0');
    expect(info.updateAvailable).toBe(true);
    expect(info.source).toBe('marketplace');
  });

  it('getNodeVersionInfo() is not updateAvailable when versions match', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { version: '63.0.0' })
    );
    const probe: MarketplaceVersionProbe = {
      getLatestVersion: jest.fn(async () => '63.0.0'),
      clearCache: jest.fn()
    };
    const svc = new ExtensionService(mkSettings(), mkCodeCli(), mkLogger());
    svc.setMarketplaceProbe(probe);
    const info = await svc.getNodeVersionInfo('salesforce.foo');
    expect(info.updateAvailable).toBe(false);
  });

  it('getNodeVersionInfo() skips the marketplace probe when updateCheck=never', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(
      makeExt('salesforce.foo', { version: '63.0.0' })
    );
    const probe: MarketplaceVersionProbe = {
      getLatestVersion: jest.fn(async () => '63.9.9'),
      clearCache: jest.fn()
    };
    const svc = new ExtensionService(
      mkSettings({ getUpdateCheck: jest.fn(() => 'never' as const) } as Partial<Record<keyof SettingsService, unknown>>),
      mkCodeCli(),
      mkLogger()
    );
    svc.setMarketplaceProbe(probe);
    const info = await svc.getNodeVersionInfo('salesforce.foo');
    expect(probe.getLatestVersion).not.toHaveBeenCalled();
    expect(info.updateAvailable).toBe(false);
  });

  it('getNodeVersionInfo() falls back to the CLI version map when packageJSON is missing', async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    const cli = mkCodeCli();
    (cli.listInstalledWithVersions as jest.Mock).mockResolvedValue({
      stdout: 'salesforce.foo@62.0.0\nsalesforce.bar@1.2.3\n',
      stderr: '',
      exitCode: 0
    });
    const svc = new ExtensionService(mkSettings(), cli, mkLogger());
    await svc.refreshInstalledCliVersions();
    const info = await svc.getNodeVersionInfo('salesforce.foo');
    expect(info.installedVersion).toBe('62.0.0');
  });

  it('parseCliVersions tolerates blank lines and malformed rows', () => {
    const map = parseCliVersions('salesforce.foo@1.0.0\n\nbad-line\nsalesforce.bar@2.0.0\n');
    expect(map.get('salesforce.foo')).toBe('1.0.0');
    expect(map.get('salesforce.bar')).toBe('2.0.0');
    expect(map.size).toBe(2);
  });
});
