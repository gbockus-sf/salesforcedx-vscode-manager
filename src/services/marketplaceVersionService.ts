import type { Logger } from '../util/logger';

/**
 * Thin wrapper around the VSCode Marketplace `extensionquery` API that probes
 * the latest published version for a given `<publisher>.<name>` id. All
 * network errors are swallowed (returns `undefined`) so a disconnected
 * machine produces no visible errors or noisy logs.
 *
 * Responses are cached per id for `cacheTtlMs` (default 1h) in memory.
 */

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const MARKETPLACE_URL =
  'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

interface CacheEntry {
  version: string | undefined;
  fetchedAt: number;
}

interface GalleryResponse {
  results?: Array<{
    extensions?: Array<{
      versions?: Array<{ version?: string }>;
    }>;
  }>;
}

/**
 * Publisher-listing response shape. We only read the fields we care about;
 * the gallery returns many more.
 */
interface PublisherListingResponse {
  results?: Array<{
    extensions?: Array<{
      publisher?: { publisherName?: string; displayName?: string };
      extensionName?: string;
      displayName?: string;
      shortDescription?: string;
      categories?: string[];
      tags?: string[];
      statistics?: Array<{ statisticName?: string; value?: number }>;
      versions?: Array<{ version?: string }>;
    }>;
  }>;
}

/** A single entry in a publisher catalog. */
export interface CatalogEntry {
  extensionId: string;
  displayName: string;
  shortDescription: string | undefined;
  categories: string[];
  version: string | undefined;
  installCount: number | undefined;
}

export interface MarketplaceVersionServiceOptions {
  logger?: Logger;
  cacheTtlMs?: number;
  /**
   * Inject a custom fetch implementation (primarily for tests). Defaults to
   * the Node 18+ global `fetch`.
   */
  fetchImpl?: FetchLike;
  /** Timeout for each marketplace request. Defaults to 5 seconds. */
  timeoutMs?: number;
}

export type Existence = 'found' | 'missing' | 'unknown';

interface ExistenceEntry {
  state: Existence;
  fetchedAt: number;
}

interface PublisherCacheEntry {
  entries: CatalogEntry[];
  fetchedAt: number;
}

export class MarketplaceVersionService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly existenceCache = new Map<string, ExistenceEntry>();
  private readonly publisherCache = new Map<string, PublisherCacheEntry>();
  private readonly logger: Logger | undefined;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly timeoutMs: number;

  constructor(options: MarketplaceVersionServiceOptions = {}) {
    this.logger = options.logger;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.fetchImpl = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  /**
   * Returns the latest published version for an extension id, or `undefined`
   * if the probe is unavailable (no fetch impl, network error, bad response).
   * Never throws.
   */
  async getLatestVersion(extensionId: string): Promise<string | undefined> {
    const cached = this.cache.get(extensionId);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.version;
    }
    const version = await this.probe(extensionId);
    this.cache.set(extensionId, { version, fetchedAt: Date.now() });
    return version;
  }

  /** Discard cached probe results so the next call hits the network. */
  clearCache(): void {
    this.cache.clear();
    this.existenceCache.clear();
    this.publisherCache.clear();
  }

  /**
   * Returns every extension under `publisherName` (e.g. `salesforce`) as
   * reported by the Marketplace gallery. Results cached `cacheTtlMs`.
   * Never throws — returns an empty array when the probe is unavailable.
   */
  async listPublisherExtensions(publisherName: string): Promise<CatalogEntry[]> {
    const cached = this.publisherCache.get(publisherName);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.entries;
    }
    const entries = await this.probePublisher(publisherName);
    this.publisherCache.set(publisherName, { entries, fetchedAt: Date.now() });
    return entries;
  }

  /**
   * Fetches one page of the gallery's extensionquery result. `searchText`
   * uses the gallery's search grammar — e.g. `publisher:"salesforce"` to
   * narrow to a single publisher. Callers still filter client-side because
   * the server-side grammar is fuzzy: it matches `publisher.displayName`
   * as well as `publisher.publisherName`.
   *
   * Flags: 0x194 = IncludeVersions (0x1) | IncludeCategoryAndTags (0x4)
   *              | IncludeStatistics (0x100).
   * pageSize 100 matches the value documented in known-working clients
   * (the StackOverflow reference implementation). Some pages return
   * strictly fewer results, which is our signal to stop paginating.
   */
  private async probePublisher(publisherName: string): Promise<CatalogEntry[]> {
    const fetchImpl = this.fetchImpl;
    if (!fetchImpl) return [];
    const pageSize = 100;
    const maxPages = 10; // 1000 results is more than any single publisher realistically has
    const out: CatalogEntry[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const body = JSON.stringify({
        filters: [
          {
            criteria: [
              { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
              { filterType: 10, value: `publisher:"${publisherName}"` }
            ],
            pageNumber: page,
            pageSize,
            sortBy: 0,
            sortOrder: 0
          }
        ],
        assetTypes: [],
        flags: 0x194
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let pageSizeReturned = 0;
      try {
        const response = await fetchImpl(MARKETPLACE_URL, {
          method: 'POST',
          headers: {
            'Accept': 'application/json;api-version=3.0-preview.1',
            'Content-Type': 'application/json'
          },
          body,
          signal: controller.signal
        });
        if (!response.ok) {
          this.logger?.warn(
            `marketplace publisher listing: ${publisherName} http ${response.status}`
          );
          return out;
        }
        const payload = (await response.json()) as PublisherListingResponse;
        const extensions = payload.results?.[0]?.extensions ?? [];
        pageSizeReturned = extensions.length;
        for (const ext of extensions) {
          const pubName = ext.publisher?.publisherName;
          const name = ext.extensionName;
          if (typeof pubName !== 'string' || typeof name !== 'string') continue;
          // Server-side search is fuzzy; drop cross-publisher matches.
          if (pubName.toLowerCase() !== publisherName.toLowerCase()) continue;
          const installs = ext.statistics?.find(s => s.statisticName === 'install')?.value;
          out.push({
            extensionId: `${pubName}.${name}`,
            displayName: typeof ext.displayName === 'string' && ext.displayName.length > 0
              ? ext.displayName
              : `${pubName}.${name}`,
            shortDescription:
              typeof ext.shortDescription === 'string' ? ext.shortDescription : undefined,
            categories: Array.isArray(ext.categories)
              ? ext.categories.filter((c): c is string => typeof c === 'string')
              : [],
            version:
              Array.isArray(ext.versions) && typeof ext.versions[0]?.version === 'string'
                ? ext.versions[0]!.version
                : undefined,
            installCount: typeof installs === 'number' ? installs : undefined
          });
        }
      } catch (err) {
        this.logger?.warn(
          `marketplace publisher listing: ${publisherName} unavailable (${err instanceof Error ? err.message : String(err)})`
        );
        return out;
      } finally {
        clearTimeout(timeout);
      }
      if (pageSizeReturned < pageSize) break;
    }
    // Stable client-side sort: by install count desc, then extensionId.
    out.sort((a, b) => {
      const ai = a.installCount ?? 0;
      const bi = b.installCount ?? 0;
      if (bi !== ai) return bi - ai;
      return a.extensionId.localeCompare(b.extensionId);
    });
    return out;
  }

  /**
   * Returns `'found'` if the id resolves on the marketplace, `'missing'` if
   * the gallery responds with zero matches (the id is bogus), or `'unknown'`
   * if the probe is unavailable (no fetch impl, network error, timeout).
   * Cached per id for the same TTL as version lookups.
   *
   * Callers use this to skip a `code --install-extension` attempt on an id
   * that definitely isn't published (e.g., the historically-bad
   * `salesforce.lightning-design-system-vscode`). Offline users always see
   * `'unknown'`, which is the safe default — installs still go through.
   */
  async resolveExistence(extensionId: string): Promise<Existence> {
    const cached = this.existenceCache.get(extensionId);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.state;
    }
    const state = await this.probeExistence(extensionId);
    this.existenceCache.set(extensionId, { state, fetchedAt: Date.now() });
    return state;
  }

  private async probeExistence(extensionId: string): Promise<Existence> {
    const fetchImpl = this.fetchImpl;
    if (!fetchImpl) return 'unknown';
    const body = JSON.stringify({
      filters: [{ criteria: [{ filterType: 7, value: extensionId }] }],
      flags: 0x1
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetchImpl(MARKETPLACE_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json;api-version=3.0-preview.1',
          'Content-Type': 'application/json'
        },
        body,
        signal: controller.signal
      });
      if (!response.ok) return 'unknown';
      const payload = (await response.json()) as GalleryResponse;
      const match = payload.results?.[0]?.extensions?.[0];
      return match ? 'found' : 'missing';
    } catch {
      return 'unknown';
    } finally {
      clearTimeout(timeout);
    }
  }

  private async probe(extensionId: string): Promise<string | undefined> {
    const fetchImpl = this.fetchImpl;
    if (!fetchImpl) return undefined;

    const body = JSON.stringify({
      filters: [
        {
          criteria: [
            { filterType: 7, value: extensionId }
          ]
        }
      ],
      flags: 0x1 // IncludeVersions
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetchImpl(MARKETPLACE_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json;api-version=3.0-preview.1',
          'Content-Type': 'application/json'
        },
        body,
        signal: controller.signal
      });
      if (!response.ok) {
        this.logger?.warn(`marketplace probe: ${extensionId} http ${response.status}`);
        return undefined;
      }
      const payload = (await response.json()) as GalleryResponse;
      const version = payload.results?.[0]?.extensions?.[0]?.versions?.[0]?.version;
      return typeof version === 'string' && version.length > 0 ? version : undefined;
    } catch (err) {
      this.logger?.warn(
        `marketplace probe: ${extensionId} unavailable (${err instanceof Error ? err.message : String(err)})`
      );
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}
