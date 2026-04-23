import type { Logger } from '../util/logger';
import type { CatalogEntry, MarketplaceVersionService } from './marketplaceVersionService';
import type { SettingsService } from './settingsService';

/**
 * Owns the publisher catalog lifecycle: refresh schedule (same as
 * `updateCheck`), cached in-memory snapshot, and a synchronous read so
 * UI consumers (tree provider, status bar, commands) don't need to
 * block on the network at render time.
 *
 * Intentionally offline-safe: when the marketplace is unreachable the
 * snapshot stays empty and the UI degrades gracefully (the "All
 * Salesforce Extensions" group simply doesn't appear).
 */
export class PublisherCatalogService {
  private snapshot: CatalogEntry[] = [];
  private refreshing: Promise<void> | undefined;
  private lastRefreshedAt: number | undefined;

  constructor(
    private readonly publisher: string,
    private readonly marketplace: MarketplaceVersionService,
    private readonly settings: SettingsService,
    private readonly logger: Logger
  ) {}

  getPublisher(): string {
    return this.publisher;
  }

  /** Sync read; returns `[]` until `refresh()` has resolved at least once. */
  current(): readonly CatalogEntry[] {
    return this.snapshot;
  }

  /** Timestamp of the last successful (or attempted) refresh, for UI hints. */
  getLastRefreshedAt(): number | undefined {
    return this.lastRefreshedAt;
  }

  /**
   * Refresh the snapshot from the marketplace. Deduplicates in-flight
   * refreshes — concurrent callers await the same promise.
   *
   * Honors the `updateCheck` setting unless `force === true`:
   *   - `onStartup` / `manual` → allowed to refresh on demand.
   *   - `never` → returns without hitting the network, snapshot unchanged.
   */
  async refresh(options: { force?: boolean } = {}): Promise<void> {
    if (!options.force && this.settings.getUpdateCheck() === 'never') {
      this.logger.info(
        `publisherCatalog(${this.publisher}): skipped — updateCheck is 'never'.`
      );
      return;
    }
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const entries = await this.marketplace.listPublisherExtensions(this.publisher);
        this.snapshot = entries;
        this.lastRefreshedAt = Date.now();
        this.logger.info(
          `publisherCatalog(${this.publisher}): ${entries.length} extensions cached.`
        );
      } catch (err) {
        // listPublisherExtensions already swallows errors; this is a
        // belt-and-suspenders guard so lifecycle failures never leak.
        this.logger.warn(
          `publisherCatalog(${this.publisher}): refresh threw (${err instanceof Error ? err.message : String(err)})`
        );
      } finally {
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }

  /** Drop the in-memory snapshot AND the marketplace cache. */
  clear(): void {
    this.snapshot = [];
    this.lastRefreshedAt = undefined;
    this.marketplace.clearCache();
  }
}
