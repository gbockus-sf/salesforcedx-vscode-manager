import type { ExtensionService } from '../services/extensionService';
import type { ApplyScope, Group } from './types';

export interface ApplyResult {
  enabled: string[];
  disabled: string[];
  installedFromVsix: string[];
  skipped: { id: string; reason: string }[];
}

export const applyGroup = async (
  group: Group,
  scope: ApplyScope,
  managedIds: string[],
  svc: ExtensionService
): Promise<ApplyResult> => {
  const result: ApplyResult = { enabled: [], disabled: [], installedFromVsix: [], skipped: [] };
  const memberSet = new Set(group.extensions);

  for (const id of group.extensions) {
    if (!svc.isInstalled(id)) {
      const install = await svc.install(id);
      if (install.exitCode === 0) {
        if (install.source === 'vsix') result.installedFromVsix.push(id);
      } else {
        result.skipped.push({ id, reason: `install failed (exit ${install.exitCode})` });
        continue;
      }
    }
    await svc.enable(id);
    result.enabled.push(id);
  }

  if (scope === 'disableOthers') {
    for (const id of managedIds) {
      if (memberSet.has(id)) continue;
      if (!svc.isInstalled(id)) continue;
      await svc.disable(id);
      result.disabled.push(id);
    }
  }

  return result;
};
