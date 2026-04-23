import * as vscode from 'vscode';
import { getLocalization, LocalizationKeys } from '../localization';
import type { SettingsService } from '../services/settingsService';
import { BUILT_IN_GROUPS } from './builtInGroups';
import { discoverPackGroups, packGroupId } from './packGroups';
import type { Group } from './types';

/**
 * When a pack is installed locally we prefer its real manifest over our
 * handcrafted static copy. This map is the single source of truth for that
 * correspondence — key is the built-in group id, value is the discovered
 * pack group id (`pack:<extensionId>`). If the discovered group is present
 * the built-in is suppressed from the tree so users never see duplicates.
 */
const BUILT_IN_TO_PACK_OVERRIDE: Record<string, string> = {
  'salesforce-extension-pack': packGroupId('salesforce.salesforcedx-vscode'),
  'salesforce-extension-pack-expanded': packGroupId('salesforce.salesforcedx-vscode-expanded')
};

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
  // User-authored ids must avoid `:` so they can't collide with the
  // `pack:<extensionId>` ids we synthesize for discovered extension packs.
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

/**
 * Optional read-side shape for the publisher catalog. Keeping it loose so
 * the store doesn't pull in the full service type (which would force the
 * test doubles to stub it).
 *
 * `loaded` distinguishes "catalog refreshed and really contains zero
 * entries" from "catalog never refreshed yet" — the tree needs that to
 * show a discoverable placeholder vs. hiding the group entirely.
 */
export interface PublisherCatalogSnapshot {
  publisher: string;
  extensionIds: readonly string[];
  loaded: boolean;
}

export class GroupStore {
  private getCatalog: (() => PublisherCatalogSnapshot | undefined) | undefined;

  constructor(private readonly settings: SettingsService) {}

  setPublisherCatalog(read: () => PublisherCatalogSnapshot | undefined): void {
    this.getCatalog = read;
  }

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
    // Resolve discovered pack groups up front so we can suppress any
    // handcrafted built-in whose corresponding pack is installed — the
    // pack's manifest is the source of truth when it's present.
    const packGroups = discoverPackGroups();
    const discoveredPackIds = new Set(packGroups.map(g => g.id));

    const merged: Group[] = [];
    const seen = new Set<string>();
    for (const builtIn of BUILT_IN_GROUPS) {
      const supplantingPackId = BUILT_IN_TO_PACK_OVERRIDE[builtIn.id];
      if (supplantingPackId && discoveredPackIds.has(supplantingPackId)) {
        // Discovery will add the live-manifest version below; skip the
        // handcrafted copy so the tree shows one entry per pack.
        continue;
      }
      const override = userById.get(builtIn.id);
      if (override) {
        merged.push({ ...override, id: builtIn.id, builtIn: true, source: 'code' });
      } else {
        merged.push({ ...builtIn, source: 'code' });
      }
      seen.add(builtIn.id);
    }
    // Discovered Salesforce extension-pack groups. Appear after the
    // handcrafted built-ins but before user groups — they're still
    // built-in semantically but sourced from whatever packs are installed.
    for (const packGroup of packGroups) {
      if (seen.has(packGroup.id)) continue; // belt-and-suspenders; pack ids use a `:` prefix
      merged.push(packGroup);
      seen.add(packGroup.id);
    }
    // Synthesized "All <Publisher> Extensions" group sourced from the
    // marketplace publisher catalog. Always present so the feature is
    // discoverable; empty-snapshot case still appears with zero members
    // so users can right-click → Refresh Salesforce Catalog.
    const catalog = this.getCatalog?.();
    if (catalog) {
      const id = `catalog:${catalog.publisher}`;
      if (!seen.has(id)) {
        const publisherLabel = catalog.publisher[0].toUpperCase() + catalog.publisher.slice(1);
        merged.push({
          id,
          label: `All ${publisherLabel} Extensions`,
          description: catalog.loaded
            ? `Every extension published by "${catalog.publisher}" on the VSCode Marketplace.`
            : `Refresh the catalog to load every extension published by "${catalog.publisher}" on the VSCode Marketplace.`,
          extensions: [...catalog.extensionIds],
          builtIn: true,
          source: 'catalog'
        });
        seen.add(id);
      }
    }
    for (const [id, g] of userById) {
      if (!seen.has(id)) merged.push({ ...g, id, builtIn: false, source: 'user' });
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
   * layer(s) contain it. Pack-discovered groups cannot be removed — their
   * definition lives in the pack's own manifest, so the only way to remove
   * them is to uninstall the pack extension.
   */
  async remove(id: string): Promise<void> {
    if (id.startsWith('pack:')) {
      throw new Error(
        'Extension-pack groups are read-only. Uninstall the pack itself to remove the group.'
      );
    }
    if (id.startsWith('catalog:')) {
      throw new Error(
        'Marketplace-catalog groups are read-only. The marketplace is the source of truth.'
      );
    }
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
    if (id.startsWith('pack:')) {
      throw new Error('Extension-pack groups live in the pack manifest and cannot be moved.');
    }
    if (id.startsWith('catalog:')) {
      throw new Error('Marketplace-catalog groups live in the marketplace and cannot be moved.');
    }
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
