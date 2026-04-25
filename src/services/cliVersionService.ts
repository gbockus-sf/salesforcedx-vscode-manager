import type { Logger } from '../util/logger';

/**
 * Probes the Salesforce CLI's official latest-version channel so the
 * Dependencies tree can flag when the user's `sf` is behind. Uses
 * the same JSON endpoint the CLI itself consults for self-update,
 * which is cheap, stable, and doesn't require shelling out to npm.
 *
 * Network failures return `undefined`; callers render the current
 * installed version without any upgrade hint. Responses cache in
 * memory for `cacheTtlMs` (default 1h) so we don't hammer the
 * endpoint across repeated dependency checks within a session.
 */

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLI_CHANNEL_URL =
  'https://developer.salesforce.com/media/salesforce-cli/sf/channels/stable/version';

type FetchLike = (
  input: string,
  init: { method: string; signal?: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

interface CacheEntry {
  version: string | undefined;
  fetchedAt: number;
}

interface VersionManifest {
  version?: string;
}

export class CliVersionService {
  private cached: CacheEntry | undefined;

  constructor(
    private readonly options: {
      logger: Logger;
      cacheTtlMs?: number;
      fetch?: FetchLike;
      timeoutMs?: number;
    }
  ) {}

  /**
   * Returns the latest stable `sf` version, or `undefined` when the
   * channel is unreachable. Cached for `cacheTtlMs`.
   */
  async getLatestVersion(): Promise<string | undefined> {
    if (this.cached && Date.now() - this.cached.fetchedAt < this.ttl()) {
      return this.cached.version;
    }
    const version = await this.probe();
    this.cached = { version, fetchedAt: Date.now() };
    return version;
  }

  /** Drop the cached snapshot so the next call re-probes. */
  clearCache(): void {
    this.cached = undefined;
  }

  private async probe(): Promise<string | undefined> {
    const fetchImpl = this.options.fetch ?? ((globalThis as unknown as { fetch?: FetchLike }).fetch);
    if (!fetchImpl) {
      this.options.logger.warn('cliVersionService: fetch unavailable; skipping probe.');
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 5000);
    try {
      const res = await fetchImpl(CLI_CHANNEL_URL, { method: 'GET', signal: controller.signal });
      if (!res.ok) {
        this.options.logger.warn(
          `cliVersionService: channel GET ${res.status} — skipping update check.`
        );
        return undefined;
      }
      const payload = (await res.json()) as VersionManifest | undefined;
      const version = typeof payload?.version === 'string' ? payload.version : undefined;
      if (!version) {
        this.options.logger.warn(
          'cliVersionService: channel payload missing `version`; skipping.'
        );
        return undefined;
      }
      this.options.logger.info(`cliVersionService: latest stable ${version}.`);
      return version;
    } catch (err) {
      // AbortError, offline, DNS failure — all non-fatal; we just
      // don't surface an upgrade hint for this session.
      const message = err instanceof Error ? err.message : String(err);
      this.options.logger.warn(`cliVersionService: probe failed (${message}).`);
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  private ttl(): number {
    return this.options.cacheTtlMs ?? DEFAULT_TTL_MS;
  }
}
