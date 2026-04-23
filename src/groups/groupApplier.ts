import type { ExtensionService } from '../services/extensionService';
import type { ApplyScope, Group } from './types';

export interface ApplyResult {
  enabled: string[];
  disabled: string[];
  installedFromVsix: string[];
  skipped: { id: string; reason: string }[];
  needsManualEnable: string[];
  needsManualDisable: string[];
  /**
   * Ids the user might have expected to be uninstalled (non-members under
   * `disableOthers`) that the manager refused to touch because other
   * installed extensions depend on them. Paired with the list of blockers.
   */
  dependencyBlocked: { id: string; blockedBy: string[] }[];
  /**
   * Ids that were transitively pulled in via `extensionDependencies` because
   * a group member required them. They are enabled and surfaced so the user
   * knows why their workspace gained extra extensions.
   */
  dependencyAutoIncluded: string[];
}

export const applyGroup = async (
  group: Group,
  scope: ApplyScope,
  managedIds: string[],
  svc: ExtensionService
): Promise<ApplyResult> => {
  const result: ApplyResult = {
    enabled: [],
    disabled: [],
    installedFromVsix: [],
    skipped: [],
    needsManualEnable: [],
    needsManualDisable: [],
    dependencyBlocked: [],
    dependencyAutoIncluded: []
  };

  // Build the effective enable set: members + transitive extensionDependencies.
  const graph = svc.getDependencyGraph();
  const memberSet = new Set(group.extensions);
  const transitiveDeps = svc.transitiveDependencies(group.extensions, graph);
  const autoIncluded: string[] = [];
  for (const depId of transitiveDeps) {
    if (!memberSet.has(depId)) autoIncluded.push(depId);
  }
  result.dependencyAutoIncluded = autoIncluded;
  const effectiveEnable = new Set<string>([...memberSet, ...transitiveDeps]);

  // Enable order: auto-included deps first (in topological order so each
  // dep's own deps precede it), then the group's listed members in authored
  // order. This preserves the user's intent for the group while still
  // satisfying dep-before-dependent for the transitive additions.
  const depEnableOrder = svc
    .topologicalUninstallOrder(autoIncluded, graph)
    .slice()
    .reverse();
  const enableOrder = [...depEnableOrder, ...group.extensions];
  for (const id of enableOrder) {
    if (!svc.isInstalled(id)) {
      const install = await svc.install(id);
      if (install.exitCode === 0) {
        if (install.source === 'vsix') result.installedFromVsix.push(id);
      } else {
        result.skipped.push({ id, reason: `install failed (exit ${install.exitCode})` });
        continue;
      }
    }
    const outcome = await svc.enable(id);
    if (outcome === 'ok') {
      result.enabled.push(id);
    } else {
      result.needsManualEnable.push(id);
    }
  }

  if (scope === 'disableOthers') {
    // Candidate set = managed ids that are installed, NOT in effective-enable.
    const candidates = new Set<string>(
      managedIds.filter(id => !effectiveEnable.has(id) && svc.isInstalled(id))
    );

    // Refuse to disable anything that a non-candidate installed extension
    // still depends on. This is what turns VSCode's 'Cannot uninstall X. Y
    // depends on this.' warnings into first-class state.
    const blocked = svc.computeBlockedByDependents(candidates, graph);
    for (const [id, blockers] of blocked) {
      candidates.delete(id);
      result.dependencyBlocked.push({ id, blockedBy: blockers });
    }

    // Uninstall in topological order so pack members come off before packs
    // and dependents come off before dependencies.
    const uninstallOrder = svc.topologicalUninstallOrder([...candidates], graph);
    for (const id of uninstallOrder) {
      const outcome = await svc.disable(id);
      if (outcome === 'ok') {
        result.disabled.push(id);
      } else {
        result.needsManualDisable.push(id);
      }
    }
  }

  return result;
};
