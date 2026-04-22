import { VsixInstaller } from '../../src/vsix/vsixInstaller';
import type { CodeCliService } from '../../src/services/codeCliService';
import type { WorkspaceStateService } from '../../src/services/workspaceStateService';
import type { Logger } from '../../src/util/logger';
import type { VsixScanner } from '../../src/vsix/vsixScanner';

const mkScanner = (overrides: Map<string, { extensionId: string; version: string; filePath: string }>): VsixScanner => ({
  isConfigured: jest.fn(() => true),
  exists: jest.fn(() => true),
  getDirectory: jest.fn(() => '/fake/dir'),
  scan: jest.fn(() => overrides),
  watch: jest.fn()
} as unknown as VsixScanner);

const mkCli = (results: { install?: { exitCode: number }; uninstall?: { exitCode: number } } = {}): CodeCliService => ({
  installExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: results.install?.exitCode ?? 0 })),
  uninstallExtension: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: results.uninstall?.exitCode ?? 0 }))
} as unknown as CodeCliService);

const mkState = (initial: Record<string, 'vsix' | 'marketplace'> = {}): WorkspaceStateService => {
  const state = { ...initial };
  return {
    getInstallSources: jest.fn(() => state),
    setInstallSource: jest.fn(async (id: string, src?: 'vsix' | 'marketplace') => {
      if (src === undefined) delete state[id];
      else state[id] = src;
    })
  } as unknown as WorkspaceStateService;
};

const mkLogger = (): Logger => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), show: jest.fn(), dispose: jest.fn()
} as unknown as Logger);

describe('VsixInstaller', () => {
  it('tryInstall returns marketplace when scanner is not configured', async () => {
    const scanner = {
      isConfigured: jest.fn(() => false),
      scan: jest.fn(() => new Map())
    } as unknown as VsixScanner;
    const installer = new VsixInstaller(scanner, mkCli(), mkState(), mkLogger());
    expect(await installer.tryInstall('foo.bar')).toBe('marketplace');
  });

  it('tryInstall returns marketplace when no matching vsix is found', async () => {
    const installer = new VsixInstaller(mkScanner(new Map()), mkCli(), mkState(), mkLogger());
    expect(await installer.tryInstall('foo.bar')).toBe('marketplace');
  });

  it('tryInstall installs from local vsix with --force and records source', async () => {
    const overrides = new Map([
      ['foo.bar', { extensionId: 'foo.bar', version: '1.0.0', filePath: '/fake/dir/foo.bar-1.0.0.vsix' }]
    ]);
    const cli = mkCli();
    const state = mkState();
    const installer = new VsixInstaller(mkScanner(overrides), cli, state, mkLogger());
    expect(await installer.tryInstall('foo.bar')).toBe('vsix');
    expect(cli.installExtension).toHaveBeenCalledWith('/fake/dir/foo.bar-1.0.0.vsix', true);
    expect(state.setInstallSource).toHaveBeenCalledWith('foo.bar', 'vsix');
  });

  it('tryInstall returns skipped when local install fails', async () => {
    const overrides = new Map([
      ['foo.bar', { extensionId: 'foo.bar', version: '1.0.0', filePath: '/fake/dir/foo.bar-1.0.0.vsix' }]
    ]);
    const installer = new VsixInstaller(
      mkScanner(overrides),
      mkCli({ install: { exitCode: 1 } }),
      mkState(),
      mkLogger()
    );
    expect(await installer.tryInstall('foo.bar')).toBe('skipped');
  });

  it('clearAllOverrides uninstalls vsix-sourced, reinstalls from marketplace, updates provenance', async () => {
    const state = mkState({ 'foo.a': 'vsix', 'foo.b': 'marketplace' });
    const cli = mkCli();
    const installer = new VsixInstaller(mkScanner(new Map()), cli, state, mkLogger());
    const cleared = await installer.clearAllOverrides();
    expect(cleared).toEqual(['foo.a']);
    expect(cli.uninstallExtension).toHaveBeenCalledWith('foo.a');
    expect(cli.installExtension).toHaveBeenCalledWith('foo.a');
    expect(state.setInstallSource).toHaveBeenCalledWith('foo.a', 'marketplace');
  });
});
