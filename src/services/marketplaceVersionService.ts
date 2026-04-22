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

export class MarketplaceVersionService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly existenceCache = new Map<string, ExistenceEntry>();
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
