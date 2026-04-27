import { describe, expect, it, jest } from '@jest/globals';
import { CliVersionService } from '../../src/services/cliVersionService';
import type { ProcessService } from '../../src/services/processService';
import type { Logger } from '../../src/util/logger';

const mkLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger);

/** Build a ProcessService stub whose `run` returns the given ExecResult. */
const mkProc = (result: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}): ProcessService => ({
  run: jest.fn(async () => ({
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.exitCode ?? 0
  }))
} as unknown as ProcessService);

/** Real-world stderr line the CLI emits when an update is pending. */
const UPDATE_STDERR =
  ' › Warning: @salesforce/cli update available from 2.130.9 to 2.131.7.\n';

describe('CliVersionService', () => {
  it('returns the latest version parsed from `sf version` stderr', async () => {
    const proc = mkProc({
      stdout: '@salesforce/cli/2.130.9 darwin-arm64 node-v22.22.2\n',
      stderr: UPDATE_STDERR
    });
    const service = new CliVersionService({ logger: mkLogger(), process: proc });
    expect(await service.getLatestVersion()).toBe('2.131.7');
    expect(proc.run).toHaveBeenCalledWith('sf', ['version'], 15_000);
  });

  it('returns undefined when the CLI output has no update warning', async () => {
    // CLI is current — no warning means nothing to do; the tree
    // just renders the installed version without a badge.
    const proc = mkProc({
      stdout: '@salesforce/cli/2.131.7 darwin-arm64 node-v22.22.2\n'
    });
    const service = new CliVersionService({ logger: mkLogger(), process: proc });
    expect(await service.getLatestVersion()).toBeUndefined();
  });

  it('caches the parsed result so repeated calls within the TTL do not re-spawn sf', async () => {
    const proc = mkProc({ stderr: UPDATE_STDERR });
    const service = new CliVersionService({
      logger: mkLogger(),
      process: proc,
      cacheTtlMs: 60_000
    });
    await service.getLatestVersion();
    await service.getLatestVersion();
    expect(proc.run).toHaveBeenCalledTimes(1);
  });

  it('clearCache forces a fresh probe on the next call', async () => {
    const proc = mkProc({ stderr: UPDATE_STDERR });
    const service = new CliVersionService({ logger: mkLogger(), process: proc });
    await service.getLatestVersion();
    service.clearCache();
    await service.getLatestVersion();
    expect(proc.run).toHaveBeenCalledTimes(2);
  });

  it('returns undefined when the sf process throws (missing binary / timeout)', async () => {
    const proc = {
      run: jest.fn(async () => {
        throw new Error('spawn sf ENOENT');
      })
    } as unknown as ProcessService;
    const service = new CliVersionService({ logger: mkLogger(), process: proc });
    expect(await service.getLatestVersion()).toBeUndefined();
  });

  it('parses pre-release version suffixes in the warning line', async () => {
    // Defensive: `2.131.7-beta.3` and friends should resolve cleanly.
    const proc = mkProc({
      stderr: ' › Warning: @salesforce/cli update available from 2.130.9 to 2.131.7-beta.3.\n'
    });
    const service = new CliVersionService({ logger: mkLogger(), process: proc });
    expect(await service.getLatestVersion()).toBe('2.131.7-beta.3');
  });

  it('finds the warning even when it lands on stdout instead of stderr', async () => {
    // Some shells / CLI versions redirect differently. We check both
    // streams so the badge doesn't disappear on a routing tweak.
    const proc = mkProc({
      stdout:
        ' › Warning: @salesforce/cli update available from 2.130.9 to 2.131.7.\n' +
        '@salesforce/cli/2.130.9 darwin-arm64 node-v22.22.2\n'
    });
    const service = new CliVersionService({ logger: mkLogger(), process: proc });
    expect(await service.getLatestVersion()).toBe('2.131.7');
  });

  it('invokes the custom command when `command` is supplied', async () => {
    // Test injection seam: lets the tests exercise the code path
    // without depending on a `sf` binary on PATH.
    const proc = mkProc({ stderr: UPDATE_STDERR });
    const service = new CliVersionService({
      logger: mkLogger(),
      process: proc,
      command: '/fake/bin/sf'
    });
    await service.getLatestVersion();
    expect(proc.run).toHaveBeenCalledWith('/fake/bin/sf', ['version'], 15_000);
  });
});
