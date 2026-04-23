import * as vscode from 'vscode';
import { SALESFORCE_PUBLISHER } from '../constants';
import type { Group } from './types';

interface ManifestWithPack {
  extensionPack?: unknown;
  displayName?: unknown;
  description?: unknown;
}

/**
 * Group id we synthesize for a discovered pack. The leading `pack:` prefix
 * keeps it from colliding with user-authored ids (we reject ids that
 * contain `:` in `validateGroup`, so there's no collision path).
 */
export const packGroupId = (extensionId: string): string => `pack:${extensionId}`;

/**
 * Human label for a discovered pack. Falls back to the extension id when
 * the manifest doesn't declare a `displayName`.
 */
const packLabel = (ext: vscode.Extension<unknown>): string => {
  const manifest = ext.packageJSON as ManifestWithPack | undefined;
  const displayName = manifest && typeof manifest.displayName === 'string' ? manifest.displayName : undefined;
  return displayName ?? ext.id;
};

const packDescription = (ext: vscode.Extension<unknown>): string | undefined => {
  const manifest = ext.packageJSON as ManifestWithPack | undefined;
  return manifest && typeof manifest.description === 'string' ? manifest.description : undefined;
};

/**
 * Discovers every installed extension whose publisher is `salesforce` and
 * whose `packageJSON.extensionPack` is non-empty. Each one becomes a
 * read-only group whose members are the pack's own declared members.
 *
 * - Source of truth is the installed pack's manifest — no hard-coded list.
 * - Static read: does not activate the pack.
 * - Stable order: sorted by extension id so a given workspace produces the
 *   same tree every reload.
 */
export const discoverPackGroups = (): Group[] => {
  const out: Group[] = [];
  for (const ext of vscode.extensions.all) {
    const publisher = ext.id.split('.')[0];
    if (publisher !== SALESFORCE_PUBLISHER) continue;
    const manifest = ext.packageJSON as ManifestWithPack | undefined;
    const pack = manifest?.extensionPack;
    if (!Array.isArray(pack) || pack.length === 0) continue;
    const members = (pack as unknown[]).filter((v): v is string => typeof v === 'string');
    if (members.length === 0) continue;
    out.push({
      id: packGroupId(ext.id),
      label: packLabel(ext),
      description: packDescription(ext),
      extensions: members,
      builtIn: true,
      source: 'pack'
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
};
