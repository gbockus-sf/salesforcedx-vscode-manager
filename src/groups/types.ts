export type ApplyScope = 'disableOthers' | 'enableOnly' | 'ask';

/**
 * Where a group's definition comes from:
 *   `code`  — code-defined built-ins (`BUILT_IN_GROUPS`).
 *   `pack`  — dynamically discovered from an installed Salesforce-published
 *             extensionPack's manifest at runtime. Read-only: the pack's
 *             package.json is the source of truth.
 *   `user`  — persisted in the user or workspace settings.
 */
export type GroupSource = 'code' | 'pack' | 'user';

export interface Group {
  id: string;
  label: string;
  description?: string;
  extensions: string[];
  applyScope?: ApplyScope;
  /** True for code-defined built-ins AND pack-discovered entries (not user-editable). */
  builtIn?: boolean;
  /** Finer-grained than `builtIn`: lets the UI distinguish code from pack. */
  source?: GroupSource;
}
