import * as vscode from 'vscode';

/**
 * Tracks which ids are currently mid-operation so the Groups tree can
 * swap the acting row's icon to a spinner and the `when`-clause gate
 * (`sfdxManager.anyBusy`) can freeze the panel until the op settles.
 *
 * Ids are refcounted: if two overlapping `withBusy([id], …)` calls run
 * concurrently, the id stays busy until the last one releases. The
 * `try/finally` inside `withBusy` guarantees release even if the
 * wrapped function throws.
 *
 * Non-row bulk ops (apply group, update-all, enable/disable all, VSIX
 * refresh, browse install) use reserved sentinel ids (`__group_apply__`,
 * `__update_all__`, …) so `hasAny()` is true without polluting
 * extension-id lookups. Callers that also want their per-target rows to
 * spin pass both the sentinel AND each id.
 */
export class BusyState {
  private readonly counts = new Map<string, number>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onChange = this.emitter.event;
  private readonly contextKey: string;

  constructor(contextKey = 'sfdxManager.anyBusy') {
    this.contextKey = contextKey;
    // Initialize the context key to false so the first render is
    // unambiguous — otherwise `when` clauses that gate on
    // `!sfdxManager.anyBusy` evaluate against an undefined key.
    void vscode.commands.executeCommand('setContext', this.contextKey, false);
  }

  isBusy(id: string): boolean {
    return (this.counts.get(id) ?? 0) > 0;
  }

  hasAny(): boolean {
    return this.counts.size > 0;
  }

  /**
   * Run `fn` with `ids` marked busy. Every id is refcount-incremented
   * on entry and decremented in `finally` — overlapping calls for the
   * same id stay busy until the last caller releases. Throws from `fn`
   * propagate after the release.
   */
  async withBusy<T>(ids: readonly string[], fn: () => Promise<T>): Promise<T> {
    const unique = Array.from(new Set(ids));
    this.acquire(unique);
    try {
      return await fn();
    } finally {
      this.release(unique);
    }
  }

  private acquire(ids: readonly string[]): void {
    const wasEmpty = this.counts.size === 0;
    for (const id of ids) {
      this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    }
    if (wasEmpty) {
      void vscode.commands.executeCommand('setContext', this.contextKey, true);
    }
    this.emitter.fire();
  }

  private release(ids: readonly string[]): void {
    for (const id of ids) {
      const next = (this.counts.get(id) ?? 0) - 1;
      if (next <= 0) this.counts.delete(id);
      else this.counts.set(id, next);
    }
    if (this.counts.size === 0) {
      void vscode.commands.executeCommand('setContext', this.contextKey, false);
    }
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

/** Reserved sentinel ids for bulk ops that don't target a single row. */
export const BUSY_SENTINELS = {
  groupApply: (groupId: string): string => `__group_apply__:${groupId}`,
  updateAll: '__update_all__',
  enableAll: '__enable_all__',
  disableAll: '__disable_all__',
  vsixRefresh: '__vsix_refresh__',
  browseInstall: '__browse_install__'
} as const;
