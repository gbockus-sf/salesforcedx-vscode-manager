import { MarketplaceVersionService } from '../../src/services/marketplaceVersionService';

type FetchInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
};

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type FetchImpl = (url: string, init: FetchInit) => Promise<FetchResponse>;

const mkFetch = (payload: unknown, ok = true, status = 200): jest.Mock => {
  const fn: FetchImpl = async (_url, _init) => ({ ok, status, json: async () => payload });
  return jest.fn(fn);
};

describe('MarketplaceVersionService', () => {
  it('returns the first version entry of the first extension result', async () => {
    const fetchImpl = mkFetch({
      results: [
        {
          extensions: [
            {
              versions: [{ version: '63.1.0' }, { version: '63.0.0' }]
            }
          ]
        }
      ]
    });
    const svc = new MarketplaceVersionService({ fetchImpl });
    const v = await svc.getLatestVersion('salesforce.foo');
    expect(v).toBe('63.1.0');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as [string, FetchInit];
    const body = JSON.parse(call[1].body) as {
      filters: Array<{ criteria: Array<{ filterType: number; value: string }> }>;
    };
    expect(body.filters[0].criteria[0]).toEqual({ filterType: 7, value: 'salesforce.foo' });
  });

  it('caches results within the TTL', async () => {
    const fetchImpl = mkFetch({
      results: [{ extensions: [{ versions: [{ version: '1.0.0' }] }] }]
    });
    const svc = new MarketplaceVersionService({ fetchImpl, cacheTtlMs: 1_000_000 });
    await svc.getLatestVersion('salesforce.foo');
    await svc.getLatestVersion('salesforce.foo');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when fetch rejects (offline)', async () => {
    const impl: FetchImpl = async () => {
      throw new Error('network unreachable');
    };
    const fetchImpl = jest.fn(impl);
    const svc = new MarketplaceVersionService({ fetchImpl });
    const v = await svc.getLatestVersion('salesforce.foo');
    expect(v).toBeUndefined();
  });

  it('returns undefined when the response is not ok', async () => {
    const fetchImpl = mkFetch({}, false, 503);
    const svc = new MarketplaceVersionService({ fetchImpl });
    const v = await svc.getLatestVersion('salesforce.foo');
    expect(v).toBeUndefined();
  });

  it('returns undefined when no fetch implementation is available', async () => {
    const svc = new MarketplaceVersionService({ fetchImpl: undefined });
    const v = await svc.getLatestVersion('salesforce.foo');
    expect(v).toBeUndefined();
  });

  it('clearCache forces a re-probe on next call', async () => {
    const fetchImpl = mkFetch({
      results: [{ extensions: [{ versions: [{ version: '1.0.0' }] }] }]
    });
    const svc = new MarketplaceVersionService({ fetchImpl, cacheTtlMs: 1_000_000 });
    await svc.getLatestVersion('salesforce.foo');
    svc.clearCache();
    await svc.getLatestVersion('salesforce.foo');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  describe('resolveExistence', () => {
    it('returns "found" when the gallery returns a matching extension', async () => {
      const fetchImpl = mkFetch({
        results: [{ extensions: [{ versions: [{ version: '1.0.0' }] }] }]
      });
      const svc = new MarketplaceVersionService({ fetchImpl });
      expect(await svc.resolveExistence('salesforce.foo')).toBe('found');
    });

    it('returns "missing" when the gallery returns zero extensions', async () => {
      const fetchImpl = mkFetch({ results: [{ extensions: [] }] });
      const svc = new MarketplaceVersionService({ fetchImpl });
      expect(await svc.resolveExistence('salesforce.bogus')).toBe('missing');
    });

    it('returns "unknown" when the probe fails (offline)', async () => {
      const impl: FetchImpl = async () => {
        throw new Error('network unreachable');
      };
      const svc = new MarketplaceVersionService({ fetchImpl: jest.fn(impl) });
      expect(await svc.resolveExistence('salesforce.foo')).toBe('unknown');
    });

    it('returns "unknown" when the response is not ok', async () => {
      const fetchImpl = mkFetch({}, false, 503);
      const svc = new MarketplaceVersionService({ fetchImpl });
      expect(await svc.resolveExistence('salesforce.foo')).toBe('unknown');
    });

    it('caches results within the TTL', async () => {
      const fetchImpl = mkFetch({ results: [{ extensions: [] }] });
      const svc = new MarketplaceVersionService({ fetchImpl, cacheTtlMs: 1_000_000 });
      await svc.resolveExistence('salesforce.bogus');
      await svc.resolveExistence('salesforce.bogus');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('clearCache clears both version and existence caches', async () => {
      const fetchImpl = mkFetch({ results: [{ extensions: [] }] });
      const svc = new MarketplaceVersionService({ fetchImpl, cacheTtlMs: 1_000_000 });
      await svc.resolveExistence('salesforce.bogus');
      svc.clearCache();
      await svc.resolveExistence('salesforce.bogus');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  describe('listPublisherExtensions', () => {
    it('maps gallery results to CatalogEntry and filters to the requested publisher', async () => {
      const fetchImpl = mkFetch({
        results: [
          {
            extensions: [
              {
                publisher: { publisherName: 'salesforce', displayName: 'Salesforce' },
                extensionName: 'salesforcedx-vscode-apex',
                displayName: 'Apex',
                shortDescription: 'Apex support',
                categories: ['Programming Languages'],
                statistics: [{ statisticName: 'install', value: 12345 }],
                versions: [{ version: '63.1.0' }]
              },
              {
                // fuzzy hit — different publisher, must be client-filtered out.
                publisher: { publisherName: 'someone-else' },
                extensionName: 'random'
              }
            ]
          }
        ]
      });
      const svc = new MarketplaceVersionService({ fetchImpl });
      const entries = await svc.listPublisherExtensions('salesforce');
      expect(entries.map(e => e.extensionId)).toEqual(['salesforce.salesforcedx-vscode-apex']);
      expect(entries[0].displayName).toBe('Apex');
      expect(entries[0].installCount).toBe(12345);
      expect(entries[0].version).toBe('63.1.0');
      expect(entries[0].categories).toEqual(['Programming Languages']);
    });

    it('paginates until a short page is returned', async () => {
      const pageSize = 100;
      const pages = [
        {
          results: [{
            extensions: Array.from({ length: pageSize }, (_, i) => ({
              publisher: { publisherName: 'salesforce' },
              extensionName: `ext-${i}`
            }))
          }]
        },
        {
          results: [{
            extensions: Array.from({ length: 3 }, (_, i) => ({
              publisher: { publisherName: 'salesforce' },
              extensionName: `ext-${100 + i}`
            }))
          }]
        }
      ];
      let call = 0;
      const impl: FetchImpl = async () => ({
        ok: true,
        status: 200,
        json: async () => pages[call++] ?? { results: [{ extensions: [] }] }
      });
      const svc = new MarketplaceVersionService({ fetchImpl: jest.fn(impl) });
      const entries = await svc.listPublisherExtensions('salesforce');
      expect(entries.length).toBe(pageSize + 3);
    });

    it('sorts client-side by install count descending', async () => {
      const fetchImpl = mkFetch({
        results: [{
          extensions: [
            {
              publisher: { publisherName: 'salesforce' },
              extensionName: 'low',
              statistics: [{ statisticName: 'install', value: 10 }]
            },
            {
              publisher: { publisherName: 'salesforce' },
              extensionName: 'high',
              statistics: [{ statisticName: 'install', value: 1000 }]
            }
          ]
        }]
      });
      const svc = new MarketplaceVersionService({ fetchImpl });
      const entries = await svc.listPublisherExtensions('salesforce');
      expect(entries.map(e => e.extensionId)).toEqual(['salesforce.high', 'salesforce.low']);
    });

    it('returns empty array when fetch throws (offline)', async () => {
      const impl: FetchImpl = async () => {
        throw new Error('offline');
      };
      const svc = new MarketplaceVersionService({ fetchImpl: jest.fn(impl) });
      expect(await svc.listPublisherExtensions('salesforce')).toEqual([]);
    });

    it('caches within the TTL', async () => {
      const fetchImpl = mkFetch({
        results: [{ extensions: [{ publisher: { publisherName: 'salesforce' }, extensionName: 'foo' }] }]
      });
      const svc = new MarketplaceVersionService({ fetchImpl, cacheTtlMs: 1_000_000 });
      await svc.listPublisherExtensions('salesforce');
      await svc.listPublisherExtensions('salesforce');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });
});
