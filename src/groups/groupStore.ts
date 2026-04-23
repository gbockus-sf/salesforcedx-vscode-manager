import * as vscode from 'vscode';
import { getLocalization, LocalizationKeys } from '../localization';
import type { SettingsService } from '../services/settingsService';
import { BUILT_IN_GROUPS } from './builtInGroups';
import type { Group } from './types';

/** Where a user-defined group lives. Built-ins are source-level. */
export type GroupScope = 'user' | 'workspace' | 'builtIn';

/**
 * Validates a group prior to persistence. Returns a human-readable reason
 * when the group would be unsafe or surprising to save, otherwise undefined.
 * Empty user groups are rejected because applying one with
 * `scope=disableOthers` would uninstall every managed extension. Empty
 * built-in overrides are allowed because the built-in default may still
 * be non-empty after merge (and the override could be a deliberate clear).
 */
export const validateGroup = (group: Group): string | undefined => {
  if (!group.id || !/^[a-z][a-z0-9-]*$/.test(group.id)) {
    return getLocalization(LocalizationKeys.validateGroupBadId);
  }
  if (!group.label || group.label.trim().length === 0) {
    return getLocalization(LocalizationKeys.validateGroupMissingLabel);
  }
  if (group.extensions.length === 0 && group.builtIn !== true) {
    return getLocalization(LocalizationKeys.validateGroupEmpty, group.label);
  }
  return undefined;
};

const isValidGroup = (id: string, raw: unknown): raw is Group => {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.label === 'string' &&
    Array.isArray(r.extensions) &&
    r.extensions.every(x => typeof x === 'string') &&
    (r.description === undefined || typeof r.description === 'string') &&
    (r.applyScope === undefined ||
      r.applyScope === 'disableOthers' ||
      r.applyScope === 'enableOnly' ||
      r.applyScope === 'ask') &&
    (id.length > 0)
  );
};

export class GroupStore {
  constructor(private readonly settings: SettingsService) {}

  list(): Group[] {
    // `.get()` already merges workspace-over-user-over-default, so this keeps
    // existing consumers seeing the effective group list without caring
    // about layers.
    const userRaw = this.settings.getGroupsRaw();
    const userById = new Map<string, Group>();
    for (const [id, raw] of Object.entries(userRaw)) {
      if (isValidGroup(id, raw)) {
        userById.set(id, { ...(raw as Group), id });
      }
    }
    const merged: Group[] = [];
    const seen = new Set<string>();
    for (const builtIn of BUILT_IN_GROUPS) {
      const override = userById.get(builtIn.id);
      if (override) {
        merged.push({ ...override, id: builtIn.id, builtIn: true });
      } else {
        merged.push(builtIn);
      }
      seen.add(builtIn.id);
    }
    for (const [id, g] of userById) {
      if (!seen.has(id)) merged.push({ ...g, id, builtIn: false });
    }
    return merged;
  }

  get(id: string): Group | undefined {
    return this.list().find(g => g.id === id);
  }

  /**
   * Where a given user-defined group currently lives. Workspace layer wins
   * over user when both are set. Built-ins return `'builtIn'`. Ids with no
   * entry in either layer are implicitly built-in (or nonexistent).
   */
  getScope(id: string): GroupScope {
    const { user, workspace } = this.settings.getGroupsByScope();
    if (id in workspace) return 'workspace';
    if (id in user) return 'user';
    return 'builtIn';
  }

  async upsert(group: Group, target: GroupScope = 'user'): Promise<void> {
    if (target === 'builtIn') {
      throw new Error('Cannot upsert into the builtIn scope.');
    }
    const reason = validateGroup(group);
    if (reason) throw new Error(reason);
    const { user, workspace } = this.settings.getGroupsByScope();
    const layer = { ...(target === 'workspace' ? workspace : user) };
    layer[group.id] = { ...group, id: undefined, builtIn: undefined };
    await this.settings.updateGroupsRaw(
      layer,
      target === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    );
  }

  /**
   * For built-ins: clears any user and workspace overrides so the group
   * reverts to defaults. For user groups: removes the entry from whichever
   * layer(s) contain it.
   */
  async remove(id: string): Promise<void> {
    const { user, workspace } = this.settings.getGroupsByScope();
    let changed = false;
    if (id in workspace) {
      const next = { ...workspace };
      delete next[id];
      await this.settings.updateGroupsRaw(next, vscode.ConfigurationTarget.Workspace);
      changed = true;
    }
    if (id in user) {
      const next = { ...user };
      delete next[id];
      await this.settings.updateGroupsRaw(next, vscode.ConfigurationTarget.Global);
      changed = true;
    }
    if (!changed) {
      const isBuiltIn = BUILT_IN_GROUPS.some(g => g.id === id);
      if (!isBuiltIn) throw new Error(getLocalization(LocalizationKeys.groupNotFound, id));
    }
  }

  /**
   * Move a user-defined group to a different scope (user ↔ workspace).
   * No-op if the group is already in the target layer.
   */
  async moveToScope(id: string, target: Exclude<GroupScope, 'builtIn'>): Promise<void> {
    const group = this.get(id);
    if (!group) throw new Error(getLocalization(LocalizationKeys.groupNotFound, id));
    const currentScope = this.getScope(id);
    if (currentScope === target) return;
    // Write the new layer first so we don't lose the group if the remove fails.
    await this.upsert(group, target);
    // Remove from the old layer only.
    const { user, workspace } = this.settings.getGroupsByScope();
    if (currentScope === 'user' && id in user) {
      const next = { ...user };
      delete next[id];
      await this.settings.updateGroupsRaw(next, vscode.ConfigurationTarget.Global);
    } else if (currentScope === 'workspace' && id in workspace) {
      const next = { ...workspace };
      delete next[id];
      await this.settings.updateGroupsRaw(next, vscode.ConfigurationTarget.Workspace);
    }
  }
}
