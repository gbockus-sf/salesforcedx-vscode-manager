import * as fs from 'fs';
import * as vscode from 'vscode';
import { DependencyRunners } from '../../src/dependencies/runners';
import { ProcessService } from '../../src/services/processService';

jest.mock('fs');

const mkProcess = (
  impl: (cmd: string, args: string[]) => { stdout: string; stderr: string; exitCode: number }
): ProcessService =>
  ({
    run: jest.fn(async (cmd: string, args: string[] = []) => impl(cmd, args))
  }) as unknown as ProcessService;

describe('DependencyRunners', () => {
  const fsExists = fs.existsSync as unknown as jest.Mock;

  beforeEach(() => {
    fsExists.mockReset();
    delete process.env.FAKE_VAR;
    (vscode.extensions.getExtension as jest.Mock).mockReset();
  });

  describe('exec', () => {
    it('ok when version meets minVersion', async () => {
      const proc = mkProcess(() => ({ stdout: 'sf-cli/2.15.4 darwin-arm64', stderr: '', exitCode: 0 }));
      const runners = new DependencyRunners(proc);
      const status = await runners.run({
        type: 'exec',
        command: 'sf',
        args: ['--version'],
        minVersion: '2.0.0'
      });
      expect(status.state).toBe('ok');
      expect(status.version).toBe('2.15.4');
    });

    it('fail when version is below minVersion', async () => {
      const proc = mkProcess(() => ({ stdout: '', stderr: 'openjdk version "1.8.0_292"', exitCode: 0 }));
      const runners = new DependencyRunners(proc);
      const status = await runners.run({
        type: 'exec',
        command: 'java',
        args: ['-version'],
        minVersion: '11.0.0',
        versionRegex: '(\\d+)\\.(\\d+)\\.(\\d+)'
      });
      expect(status.state).toBe('fail');
    });

    it('warn when no version can be parsed but command ran', async () => {
      const proc = mkProcess(() => ({ stdout: 'just some output', stderr: '', exitCode: 0 }));
      const runners = new DependencyRunners(proc);
      const status = await runners.run({
        type: 'exec',
        command: 'thing',
        minVersion: '1.0.0'
      });
      expect(status.state).toBe('warn');
    });

    it('fail when command exits non-zero with no output', async () => {
      const proc = mkProcess(() => ({ stdout: '', stderr: '', exitCode: 127 }));
      const runners = new DependencyRunners(proc);
      const status = await runners.run({ type: 'exec', command: 'nope' });
      expect(status.state).toBe('fail');
    });

    it('ok when no minVersion is specified and exitCode is 0', async () => {
      const proc = mkProcess(() => ({ stdout: 'git version 2.40.0', stderr: '', exitCode: 0 }));
      const runners = new DependencyRunners(proc);
      const status = await runners.run({ type: 'exec', command: 'git', args: ['--version'] });
      expect(status.state).toBe('ok');
      expect(status.version).toBe('2.40.0');
    });
  });

  describe('env', () => {
    it('ok when env var is set and non-empty', async () => {
      process.env.FAKE_VAR = '/opt/tools';
      const runners = new DependencyRunners(mkProcess(() => ({ stdout: '', stderr: '', exitCode: 1 })));
      const status = await runners.run({ type: 'env', env: 'FAKE_VAR' });
      expect(status.state).toBe('ok');
    });

    it('fail when env var is missing and no fallback is provided', async () => {
      const runners = new DependencyRunners(mkProcess(() => ({ stdout: '', stderr: '', exitCode: 1 })));
      const status = await runners.run({ type: 'env', env: 'FAKE_VAR' });
      expect(status.state).toBe('fail');
    });

    it('delegates to a fallback CheckDefinition when env var is missing', async () => {
      const proc = mkProcess(() => ({ stdout: '', stderr: 'openjdk version "11.0.20"', exitCode: 0 }));
      const runners = new DependencyRunners(proc);
      const status = await runners.run({
        type: 'env',
        env: 'FAKE_VAR',
        fallback: {
          type: 'exec',
          command: 'java',
          args: ['-version'],
          minVersion: '11.0.0'
        }
      });
      expect(status.state).toBe('ok');
      expect(status.version).toBe('11.0.20');
    });

    it('propagates a failed fallback with context', async () => {
      const proc = mkProcess(() => ({ stdout: '', stderr: '', exitCode: 127 }));
      const runners = new DependencyRunners(proc);
      const status = await runners.run({
        type: 'env',
        env: 'FAKE_VAR',
        fallback: { type: 'exec', command: 'java' }
      });
      expect(status.state).toBe('fail');
      expect(status.detail).toContain('FAKE_VAR');
    });

    it('treats whitespace-only env var as unset', async () => {
      process.env.FAKE_VAR = '   ';
      const runners = new DependencyRunners(mkProcess(() => ({ stdout: '', stderr: '', exitCode: 1 })));
      const status = await runners.run({ type: 'env', env: 'FAKE_VAR' });
      expect(status.state).toBe('fail');
    });
  });

  describe('file', () => {
    it('ok when the file exists', async () => {
      fsExists.mockReturnValue(true);
      const runners = new DependencyRunners(mkProcess(() => ({ stdout: '', stderr: '', exitCode: 0 })));
      const status = await runners.run({ type: 'file', path: '/some/file' });
      expect(status.state).toBe('ok');
    });

    it('fail when the file does not exist', async () => {
      fsExists.mockReturnValue(false);
      const runners = new DependencyRunners(mkProcess(() => ({ stdout: '', stderr: '', exitCode: 0 })));
      const status = await runners.run({ type: 'file', path: '/missing' });
      expect(status.state).toBe('fail');
    });

    it('expands ${HOME}', async () => {
      fsExists.mockReturnValue(true);
      const runners = new DependencyRunners(mkProcess(() => ({ stdout: '', stderr: '', exitCode: 0 })));
      await runners.run({ type: 'file', path: '${HOME}/foo' });
      const callArg = fsExists.mock.calls[0][0] as string;
      expect(callArg).not.toContain('${HOME}');
    });

    it('expands ${workspaceFolder} when a folder is open', async () => {
      fsExists.mockReturnValue(true);
      (vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }).workspaceFolders = [
        { uri: { fsPath: '/work/root' } }
      ];
      const runners = new DependencyRunners(mkProcess(() => ({ stdout: '', stderr: '', exitCode: 0 })));
      await runners.run({ type: 'file', path: '${workspaceFolder}/a.json' });
      (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = undefined;
      const callArg = fsExists.mock.calls[0][0] as string;
      expect(callArg).toBe('/work/root/a.json');
    });
  });

  describe('nodeVersion', () => {
    it('ok when current Node meets minVersion', async () => {
      const runners = new DependencyRunners(mkProcess(() => ({ stdout: '', stderr: '', exitCode: 0 })));
      const status = await runners.run({ type: 'nodeVersion', minVersion: '0.0.1' });
      expect(status.state).toBe('ok');
      expect(status.version).toBe(process.versions.node);
    });

    it('fail when current Node is below minVersion', async () => {
      const runners = new DependencyRunners(mkProcess(() => ({ stdout: '', stderr: '', exitCode: 0 })));
      const status = await runners.run({ type: 'nodeVersion', minVersion: '999.0.0' });
      expect(status.state).toBe('fail');
    });
  });

  describe('extensionInstalled', () => {
    it('ok when vscode.extensions.getExtension returns a truthy value', async () => {
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue({ id: 'x.y' });
      const runners = new DependencyRunners(mkProcess(() => ({ stdout: '', stderr: '', exitCode: 0 })));
      const status = await runners.run({ type: 'extensionInstalled', extensionId: 'x.y' });
      expect(status.state).toBe('ok');
    });

    it('fail when the extension is not installed', async () => {
      (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);
      const runners = new DependencyRunners(mkProcess(() => ({ stdout: '', stderr: '', exitCode: 0 })));
      const status = await runners.run({ type: 'extensionInstalled', extensionId: 'x.y' });
      expect(status.state).toBe('fail');
    });
  });
});
