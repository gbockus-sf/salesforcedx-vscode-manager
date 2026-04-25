import { describe, expect, it, jest } from '@jest/globals';
import { CliVersionService } from '../../src/services/cliVersionService';
import type { Logger } from '../../src/util/logger';

const mkLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger);

describe('CliVersionService', () => {
  it('returns the version from the channel JSON on a successful probe', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: '2.46.1' })
    }));
    const service = new CliVersionService({
      logger: mkLogger(),
      fetch: fetchImpl as unknown as typeof fetch
    });
    expect(await service.getLatestVersion()).toBe('2.46.1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('caches the result so repeated calls within the TTL do not re-probe', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: '2.46.1' })
    }));
    const service = new CliVersionService({
      logger: mkLogger(),
      fetch: fetchImpl as unknown as typeof fetch,
      cacheTtlMs: 60_000
    });
    await service.getLatestVersion();
    await service.getLatestVersion();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('clearCache forces a fresh probe on the next call', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: '2.46.1' })
    }));
    const service = new CliVersionService({
      logger: mkLogger(),
      fetch: fetchImpl as unknown as typeof fetch
    });
    await service.getLatestVersion();
    service.clearCache();
    await service.getLatestVersion();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns undefined when the channel responds with a non-OK status', async () => {
    // Offline / DNS failure / rate-limit — never throw, never surface
    // the failure to the user. The tree just doesn't show the badge.
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const service = new CliVersionService({
      logger: mkLogger(),
      fetch: fetchImpl as unknown as typeof fetch
    });
    expect(await service.getLatestVersion()).toBeUndefined();
  });

  it('returns undefined when fetch throws (offline / aborted)', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('offline');
    });
    const service = new CliVersionService({
      logger: mkLogger(),
      fetch: fetchImpl as unknown as typeof fetch
    });
    expect(await service.getLatestVersion()).toBeUndefined();
  });

  it('returns undefined when the payload is missing a version field', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({})
    }));
    const service = new CliVersionService({
      logger: mkLogger(),
      fetch: fetchImpl as unknown as typeof fetch
    });
    expect(await service.getLatestVersion()).toBeUndefined();
  });
});
