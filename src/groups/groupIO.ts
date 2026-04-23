import type { SettingsService } from '../services/settingsService';
import { BUILT_IN_GROUPS } from './builtInGroups';
import { validateGroup } from './groupStore';
import type { Group } from './types';

/**
 * Shape of an exported groups file. `version` lets future readers reject
 * files written by a newer major version cleanly.
 */
export interface GroupsExport {
  version: 1;
  exportedAt: string;
  groups: Group[];
}

export interface ExportOptions {
  /** Include built-in groups too? Default is user-only (built-ins are in code). */
  includeBuiltIns?: boolean;
}

/**
 * Produces the JSON payload for `SFDX Manager: Export Groups`. By default
 * only user-defined groups are exported — built-ins travel in code and
 * shouldn't pollute a shared export.
 */
export const buildExport = (
  settings: SettingsService,
  options: ExportOptions = {}
): GroupsExport => {
  const raw = settings.getGroupsRaw();
  const builtInIds = new Set(BUILT_IN_GROUPS.map(g => g.id));
  const groups: Group[] = [];
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const candidate: Group = {
      id,
      label: typeof record.label === 'string' ? record.label : id,
      description: typeof record.description === 'string' ? record.description : undefined,
      extensions: Array.isArray(record.extensions)
        ? (record.extensions as unknown[]).filter((v): v is string => typeof v === 'string')
        : [],
      applyScope:
        record.applyScope === 'disableOthers' ||
        record.applyScope === 'enableOnly' ||
        record.applyScope === 'ask'
          ? record.applyScope
          : undefined
    };
    if (options.includeBuiltIns || !builtInIds.has(id)) {
      groups.push(candidate);
    }
  }
  return { version: 1, exportedAt: new Date().toISOString(), groups };
};

export type ImportConflictStrategy = 'overwrite' | 'skip' | 'skip-all' | 'ask';

export interface ImportResult {
  imported: string[];
  skipped: { id: string; reason: string }[];
}

/**
 * Parses and validates an imported file. Throws a user-friendly Error when
 * the file is not a recognizable export. Individual invalid group entries
 * are skipped with a reason rather than failing the whole import.
 */
export const parseImport = (raw: string): Group[] => {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    throw new Error(`not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('file does not contain a JSON object');
  }
  const record = payload as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error(`unsupported export version ${String(record.version)}`);
  }
  if (!Array.isArray(record.groups)) {
    throw new Error('missing `groups` array');
  }
  const out: Group[] = [];
  for (const entry of record.groups) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.label !== 'string') continue;
    if (!Array.isArray(r.extensions)) continue;
    out.push({
      id: r.id,
      label: r.label,
      description: typeof r.description === 'string' ? r.description : undefined,
      extensions: (r.extensions as unknown[]).filter((v): v is string => typeof v === 'string'),
      applyScope:
        r.applyScope === 'disableOthers' || r.applyScope === 'enableOnly' || r.applyScope === 'ask'
          ? r.applyScope
          : undefined
    });
  }
  return out;
};

/**
 * Applies parsed groups to the settings store, honoring per-id conflict
 * strategy. Does not return until all writes are sequenced.
 */
export const applyImport = async (
  imported: readonly Group[],
  settings: SettingsService,
  resolveConflict: (existing: Group) => Promise<ImportConflictStrategy>
): Promise<ImportResult> => {
  const result: ImportResult = { imported: [], skipped: [] };
  const raw: Record<string, unknown> = { ...settings.getGroupsRaw() };
  let strategyForRest: ImportConflictStrategy | undefined;

  for (const group of imported) {
    const validationError = validateGroup({ ...group, builtIn: false });
    if (validationError) {
      result.skipped.push({ id: group.id, reason: validationError });
      continue;
    }

    const existing = raw[group.id];
    if (existing && !strategyForRest) {
      const existingGroup: Group = {
        id: group.id,
        label:
          typeof (existing as { label?: unknown }).label === 'string'
            ? (existing as { label: string }).label
            : group.id,
        extensions: Array.isArray((existing as { extensions?: unknown }).extensions)
          ? ((existing as { extensions: unknown[] }).extensions).filter(
              (v): v is string => typeof v === 'string'
            )
          : []
      };
      const strategy = await resolveConflict(existingGroup);
      if (strategy === 'skip') {
        result.skipped.push({ id: group.id, reason: 'conflict' });
        continue;
      }
      if (strategy === 'skip-all') {
        strategyForRest = 'skip';
        result.skipped.push({ id: group.id, reason: 'conflict' });
        continue;
      }
    } else if (existing && strategyForRest === 'skip') {
      result.skipped.push({ id: group.id, reason: 'conflict' });
      continue;
    }

    raw[group.id] = {
      label: group.label,
      description: group.description,
      extensions: group.extensions,
      applyScope: group.applyScope
    };
    result.imported.push(group.id);
  }

  await settings.updateGroupsRaw(raw);
  return result;
};
