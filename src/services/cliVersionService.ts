import type { ProcessService } from './processService';
import type { Logger } from '../util/logger';

/**
 * Figures out whether the installed Salesforce CLI has an upgrade
 * pending. Strategy: shell out to `sf version` and parse the
 * update-available warning the CLI itself prints on stderr when its
 * own self-update detector has noticed a newer build. This
 * intentionally piggybacks on whatever release channel the user's
 * CLI is configured to read from (npm / oclif / installer), so our
 * answer matches what `sf update` would do — no second network
 * probe, no channel-URL guessing, no extra auth considerations.
 *
 * Example stderr the parser matches:
 *   › Warning: @salesforce/cli update available from 2.130.9 to 2.131.7.
 *
 * When `sf` isn't installed, times out, exits non-zero, or doesn't
 * print a warning, we return `undefined` and the tree renders
 * without an upgrade hint — same graceful-no-op as before. Results
 * cache in memory for `cacheTtlMs` (default 1h).
 */

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
// `sf version` runs the self-update check only occasionally inside
// the CLI itself; run it here with a generous timeout so the warning
// path has time to fire. The CLI may block briefly while it refreshes
// its update cache.
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Match `Warning: @salesforce/cli update available from <installed>
 * to <latest>.`. Version pattern is deliberately loose — digits,
 * dots, dashes, pluses, and word chars — so pre-releases like
 * `2.131.7-beta.3` still parse. The sentence-ending period gets
 * stripped after the match so it doesn't leak into the captured
 * version.
 */
const UPDATE_WARNING_RE =
  /update available from\s+(\d[\w.+-]*)\s+to\s+(\d[\w.+-]*)/i;

const stripTrailingPeriod = (v: string): string =>
  v.endsWith('.') ? v.slice(0, -1) : v;

interface CacheEntry {
  version: string | undefined;
  fetchedAt: number;
}

export class CliVersionService {
  private cached: CacheEntry | undefined;

  constructor(
    private readonly options: {
      logger: Logger;
      process: ProcessService;
      cacheTtlMs?: number;
      timeoutMs?: number;
      /**
       * Injection seam for tests. Defaults to `sf`; production always
       * resolves the CLI via the user's `PATH`.
       */
      command?: string;
    }
  ) {}

  /**
   * Returns the latest `sf` version when the CLI has flagged an
   * update as available; `undefined` otherwise (including when the
   * installed CLI is already current — no warning, nothing to
   * report). Cached for `cacheTtlMs`.
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
    const command = this.options.command ?? 'sf';
    try {
      const result = await this.options.process.run(
        command,
        ['version'],
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      );
      // The CLI emits the update warning on stderr; stdout carries the
      // version string. Search both so we stay robust to future CLI
      // wiring changes.
      const combined = `${result.stdout}\n${result.stderr}`;
      const match = UPDATE_WARNING_RE.exec(combined);
      if (!match) {
        this.options.logger.info(
          `cliVersionService: no update warning from \`${command} version\` — treating CLI as current.`
        );
        return undefined;
      }
      const installed = stripTrailingPeriod(match[1]);
      const latest = stripTrailingPeriod(match[2]);
      this.options.logger.info(
        `cliVersionService: \`${command} version\` reports update available from ${installed} to ${latest}.`
      );
      return latest;
    } catch (err) {
      // sf missing from PATH, timeout, spawn failure — all non-fatal;
      // the dep tree's `builtin.sf-cli` row will already have flagged
      // a missing CLI.
      const message = err instanceof Error ? err.message : String(err);
      this.options.logger.warn(`cliVersionService: probe failed (${message}).`);
      return undefined;
    }
  }

  private ttl(): number {
    return this.options.cacheTtlMs ?? DEFAULT_TTL_MS;
  }
}
