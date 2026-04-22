import type { SettingsService } from '../services/settingsService';
import { BUILT_IN_GROUPS } from './builtInGroups';
import type { Group } from './types';

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

  async upsert(group: Group): Promise<void> {
    if (!group.id) throw new Error('Group id is required');
    const raw = { ...this.settings.getGroupsRaw() };
    raw[group.id] = { ...group, id: undefined, builtIn: undefined };
    await this.settings.updateGroupsRaw(raw);
  }

  /**
   * For built-ins: clears any user override so the group reverts to defaults.
   * For user groups: removes the entry entirely.
   */
  async remove(id: string): Promise<void> {
    const raw = { ...this.settings.getGroupsRaw() };
    if (!(id in raw)) {
      const isBuiltIn = BUILT_IN_GROUPS.some(g => g.id === id);
      if (!isBuiltIn) throw new Error(`Group "${id}" not found.`);
      return;
    }
    delete raw[id];
    await this.settings.updateGroupsRaw(raw);
  }
}
