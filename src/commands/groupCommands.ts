import * as vscode from 'vscode';
import { COMMANDS, CONFIG_NAMESPACE, SETTINGS } from '../constants';
import { applyGroup } from '../groups/groupApplier';
import {
  applyImport,
  buildExport,
  parseImport,
  type ImportConflictStrategy
} from '../groups/groupIO';
import type { GroupStore } from '../groups/groupStore';
import type { ApplyScope, Group } from '../groups/types';
import { getLocalization, LocalizationKeys } from '../localization';
import { notifyWarn } from '../util/notify';
import { maybeReloadAfterChange } from '../util/reloadPrompt';
import type { ExtensionService } from '../services/extensionService';
import type { SettingsService } from '../services/settingsService';
import { TelemetryService } from '../services/telemetryService';
import type { WorkspaceStateService } from '../services/workspaceStateService';
import type { Logger } from '../util/logger';
import type { GroupsTreeProvider } from '../views/groupsTreeProvider';

interface Deps {
  store: GroupStore;
  extensions: ExtensionService;
  settings: SettingsService;
  workspaceState: WorkspaceStateService;
  logger: Logger;
  tree: GroupsTreeProvider;
  onAfterApply?: () => void;
}

interface GroupTreeContext {
  group?: Group;
}

const resolveScope = async (
  group: Group,
  settings: SettingsService,
  workspaceState: WorkspaceStateService
): Promise<ApplyScope | undefined> => {
  const perGroup = group.applyScope;
  if (perGroup && perGroup !== 'ask') return perGroup;

  const remembered = workspaceState.getApplyScopeChoice(group.id);
  if (remembered) return remembered;

  const configScope = settings.getApplyScope();
  if (configScope !== 'ask' && perGroup !== 'ask') return configScope;

  const choice = await vscode.window.showQuickPick(
    [
      { label: getLocalization(LocalizationKeys.applyScopeDisableOthers), scope: 'disableOthers' as const },
      { label: getLocalization(LocalizationKeys.applyScopeEnableOnly), scope: 'enableOnly' as const }
    ],
    { placeHolder: getLocalization(LocalizationKeys.applyScopePromptPlaceholder, group.label) }
  );
  if (!choice) return undefined;
  await workspaceState.setApplyScopeChoice(group.id, choice.scope);
  return choice.scope;
};

const runApply = async (group: Group, deps: Deps): Promise<void> => {
  // Catalog groups are too large to apply as a single group — `disableOthers`
  // would uninstall anything not on the full catalog, and even `enableOnly`
  // would install every Salesforce extension ever published. Force the user
  // through the per-extension Install buttons or the Browse command.
  if (group.source === 'catalog') {
    await notifyWarn(getLocalization(LocalizationKeys.catalogCannotApplyAsGroup));
    return;
  }
  // Applying a 0-member group with disableOthers scope would wipe out
  // every managed extension. The empty-user-group case is already blocked
  // at save-time by validateGroup.
  if (group.extensions.length === 0) {
    await notifyWarn(`Group "${group.label}" has no members.`);
    return;
  }
  const scope = await resolveScope(group, deps.settings, deps.workspaceState);
  if (!scope) return;
  const managedIds = deps.extensions.managed().map(e => e.id);
  deps.logger.info(
    `Applying "${group.label}" (scope=${scope}). Members=${group.extensions.length}, managedIds=${managedIds.length}`
  );
  const result = await applyGroup(group, scope, managedIds, deps.extensions);
  await deps.workspaceState.setActiveGroupId(group.id);
  deps.tree.refresh();
  deps.onAfterApply?.();

  deps.logger.info(
    `Apply result: enabled=${result.enabled.length} disabled=${result.disabled.length} ` +
      `vsix=${result.installedFromVsix.length} manualEnable=${result.needsManualEnable.length} ` +
      `manualDisable=${result.needsManualDisable.length} skipped=${result.skipped.length} ` +
      `depBlocked=${result.dependencyBlocked.length} depAutoIncluded=${result.dependencyAutoIncluded.length}`
  );
  if (result.dependencyBlocked.length > 0) {
    for (const { id, blockedBy } of result.dependencyBlocked) {
      deps.logger.info(`  blocked: ${id} (dependents: ${blockedBy.join(', ')})`);
    }
  }

  const parts: string[] = [
    getLocalization(LocalizationKeys.applySummaryApplied, group.label),
    getLocalization(LocalizationKeys.applySummaryEnabled, result.enabled.length)
  ];
  if (result.disabled.length) parts.push(getLocalization(LocalizationKeys.applySummaryDisabled, result.disabled.length));
  if (result.installedFromVsix.length) parts.push(getLocalization(LocalizationKeys.applySummaryVsix, result.installedFromVsix.length));
  if (result.dependencyAutoIncluded.length) {
    parts.push(getLocalization(LocalizationKeys.applySummaryDepAutoIncluded, result.dependencyAutoIncluded.length));
  }
  if (result.dependencyBlocked.length) parts.push(getLocalization(LocalizationKeys.applySummaryDepBlocked, result.dependencyBlocked.length));
  if (result.needsManualEnable.length) parts.push(getLocalization(LocalizationKeys.applySummaryManualEnable, result.needsManualEnable.length));
  if (result.needsManualDisable.length) parts.push(getLocalization(LocalizationKeys.applySummaryManualDisable, result.needsManualDisable.length));
  if (result.skipped.length) parts.push(getLocalization(LocalizationKeys.applySummarySkipped, result.skipped.length));

  const summary = parts.join(' · ');
  deps.logger.info(summary);
  TelemetryService.sendGroupApply({
    groupId: group.id,
    source: group.source ?? (group.builtIn ? 'code' : 'user'),
    scope,
    enabled: result.enabled.length,
    disabled: result.disabled.length,
    depBlocked: result.dependencyBlocked.length,
    manualEnable: result.needsManualEnable.length,
    manualDisable: result.needsManualDisable.length,
    skipped: result.skipped.length,
    installedFromVsix: result.installedFromVsix.length
  });
  // Only notify when the apply result contains something the user needs
  // to know about that isn't visible in the tree: anything blocked by
  // dependents, extensions needing manual enable/disable, or skipped ids.
  // The reload prompt (maybeReloadAfterApply) handles the "touched, go
  // reload" path separately, so clean applies stay silent.
  const hasActionable =
    result.dependencyBlocked.length +
      result.needsManualEnable.length +
      result.needsManualDisable.length +
      result.skipped.length >
    0;
  if (hasActionable) {
    await notifyWarn(summary, { logger: deps.logger });
  }

  if (result.needsManualDisable.length) {
    await deps.extensions.showManualToggleHint(result.needsManualDisable, 'Disable');
  } else if (result.needsManualEnable.length) {
    await deps.extensions.showManualToggleHint(result.needsManualEnable, 'Enable');
  }

  await maybeReloadAfterApply(result, deps);
};

const maybeReloadAfterApply = async (
  result: Awaited<ReturnType<typeof applyGroup>>,
  deps: Deps
): Promise<void> => {
  const touched =
    result.enabled.length + result.disabled.length + result.installedFromVsix.length > 0;
  await maybeReloadAfterChange(touched, deps.settings);
};

const pickGroup = async (deps: Deps, placeholder?: string): Promise<Group | undefined> => {
  const groups = deps.store.list();
  const choice = await vscode.window.showQuickPick(
    groups.map(g => ({
      label: g.label,
      description: g.builtIn
        ? getLocalization(LocalizationKeys.groupBuiltIn)
        : getLocalization(LocalizationKeys.groupCustom),
      detail: g.description,
      group: g
    })),
    { placeHolder: placeholder ?? getLocalization(LocalizationKeys.pickGroupDefaultPrompt) }
  );
  return choice?.group;
};

const pickMembers = async (
  deps: Deps,
  currentMembers: readonly string[] = []
): Promise<string[] | undefined> => {
  const selected = new Set(currentMembers);
  const options = deps.extensions.managed().map(ext => ({
    label: ext.id,
    description: (ext.packageJSON as { displayName?: string } | undefined)?.displayName,
    picked: selected.has(ext.id)
  }));
  const picks = await vscode.window.showQuickPick(options, {
    canPickMany: true,
    placeHolder: getLocalization(LocalizationKeys.pickMembersPlaceholder)
  });
  if (!picks) return undefined;
  return picks.map(p => p.label);
};

export const registerGroupCommands = (context: vscode.ExtensionContext, deps: Deps): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      COMMANDS.applyGroupQuickPick,
      async () => {
        const group = await pickGroup(deps);
        if (group) await runApply(group, deps);
      }
    ),

    vscode.commands.registerCommand(
      COMMANDS.applyGroup,
      async (arg?: string | GroupTreeContext) => {
        let group: Group | undefined;
        if (typeof arg === 'string') group = deps.store.get(arg);
        else if (arg && 'group' in arg && arg.group) group = arg.group;
        else group = await pickGroup(deps);
        if (group) await runApply(group, deps);
      }
    ),

    vscode.commands.registerCommand(COMMANDS.enableAllSalesforce, async () => {
      const ids = deps.extensions.managed().map(e => e.id);
      for (const id of ids) await deps.extensions.enable(id);
      deps.tree.refresh();
      // Toast suppressed: the tree rows flip from disabled to enabled.
      deps.logger.info(`enableAllSalesforce: enabled ${ids.length} managed extensions.`);
    }),

    vscode.commands.registerCommand(COMMANDS.disableAllSalesforce, async () => {
      // Skip :locked ids (core + services are pulled in as
      // extensionDependencies — VSCode refuses to uninstall them while
      // manager is installed, and our `disable` uses `code --uninstall`).
      const ids = deps.extensions
        .managed()
        .map(e => e.id)
        .filter(id => !deps.extensions.isLocked(id));
      for (const id of ids) await deps.extensions.disable(id);
      await deps.workspaceState.setActiveGroupId(undefined);
      deps.tree.refresh();
      // Toast suppressed: the tree and status bar reflect the state change.
      deps.logger.info(`disableAllSalesforce: disabled ${ids.length} managed extensions (locked ids skipped).`);
    }),

    vscode.commands.registerCommand(COMMANDS.createCustomGroup, async () => {
      const id = await vscode.window.showInputBox({
        prompt: getLocalization(LocalizationKeys.createGroupIdPrompt),
        validateInput: v =>
          !v?.match(/^[a-z][a-z0-9-]*$/)
            ? getLocalization(LocalizationKeys.createGroupIdValidationFormat)
            : deps.store.get(v)
              ? getLocalization(LocalizationKeys.createGroupIdValidationDuplicate, v)
              : undefined
      });
      if (!id) return;
      const label = await vscode.window.showInputBox({
        prompt: getLocalization(LocalizationKeys.createGroupLabelPrompt)
      });
      if (!label) return;
      const members = await pickMembers(deps);
      if (members === undefined) return;
      await deps.store.upsert({ id, label, extensions: members });
      deps.tree.refresh();
      // Toast suppressed: the new group appears in the tree.
      deps.logger.info(`createCustomGroup: "${label}" (${id}) with ${members.length} members.`);
    }),

    vscode.commands.registerCommand(
      COMMANDS.editGroup,
      async (arg?: string | GroupTreeContext) => {
        let group: Group | undefined;
        if (typeof arg === 'string') group = deps.store.get(arg);
        else if (arg && 'group' in arg && arg.group) group = arg.group;
        else group = await pickGroup(deps);
        if (!group) return;

        const members = await pickMembers(deps, group.extensions);
        if (members === undefined) return;
        await deps.store.upsert({ ...group, extensions: members });
        deps.tree.refresh();
        // Toast suppressed: the tree refreshes with the new member list.
        deps.logger.info(`editGroup: "${group.label}" now has ${members.length} members.`);
      }
    ),

    vscode.commands.registerCommand(
      COMMANDS.deleteGroup,
      async (arg?: string | GroupTreeContext) => {
        let group: Group | undefined;
        if (typeof arg === 'string') group = deps.store.get(arg);
        else if (arg && 'group' in arg && arg.group) group = arg.group;
        else group = await pickGroup(deps);
        if (!group) return;
        const verb = group.builtIn
          ? getLocalization(LocalizationKeys.deleteGroupVerbReset)
          : getLocalization(LocalizationKeys.deleteGroupVerbDelete);
        const confirm = await vscode.window.showWarningMessage(
          getLocalization(LocalizationKeys.deleteGroupConfirm, verb, group.label),
          { modal: true },
          verb
        );
        if (confirm !== verb) return;
        await deps.store.remove(group.id);
        deps.tree.refresh();
        // Toast suppressed: the group disappears from the tree (user
        // groups) or reverts to its built-in defaults. The modal above
        // already asked for explicit confirmation.
        deps.logger.info(
          `deleteGroup: "${group.label}" ${group.builtIn ? 'reset to default' : 'removed'}.`
        );
      }
    ),

    vscode.commands.registerCommand(COMMANDS.openGroupsConfig, async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        `${CONFIG_NAMESPACE}.${SETTINGS.groups}`
      );
    }),

    vscode.commands.registerCommand(
      COMMANDS.moveGroupScope,
      async (arg?: string | GroupTreeContext) => {
        let group: Group | undefined;
        if (typeof arg === 'string') group = deps.store.get(arg);
        else if (arg && 'group' in arg && arg.group) group = arg.group;
        else group = await pickGroup(deps);
        if (!group) return;
        if (group.builtIn) {
          void vscode.window.showErrorMessage(
            getLocalization(LocalizationKeys.moveGroupScopeBuiltInError)
          );
          return;
        }
        const userLabel = getLocalization(LocalizationKeys.moveGroupScopeToUser);
        const workspaceLabel = getLocalization(LocalizationKeys.moveGroupScopeToWorkspace);
        const pick = await vscode.window.showQuickPick(
          [
            { label: userLabel, target: 'user' as const },
            { label: workspaceLabel, target: 'workspace' as const }
          ],
          { placeHolder: getLocalization(LocalizationKeys.moveGroupScopePrompt, group.label) }
        );
        if (!pick) return;
        await deps.store.moveToScope(group.id, pick.target);
        deps.tree.refresh();
        // Toast suppressed: the tree badge flips between "user" and
        // "workspace". Log so the provenance is auditable.
        deps.logger.info(`moveGroupScope: "${group.label}" moved to ${pick.target} scope.`);
      }
    ),

    vscode.commands.registerCommand(COMMANDS.exportGroups, async () => {
      const payload = buildExport(deps.settings);
      if (payload.groups.length === 0) {
        void vscode.window.showInformationMessage(
          getLocalization(LocalizationKeys.exportNoUserGroups)
        );
        return;
      }
      const uri = await vscode.window.showSaveDialog({
        title: getLocalization(LocalizationKeys.exportSaveDialogTitle),
        saveLabel: getLocalization(LocalizationKeys.exportSaveDialogLabel),
        defaultUri: vscode.Uri.file('sfdx-manager-groups.json'),
        filters: { JSON: ['json'] }
      });
      if (!uri) return;
      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(JSON.stringify(payload, null, 2), 'utf8')
      );
      void vscode.window.showInformationMessage(
        getLocalization(LocalizationKeys.exportSuccess, payload.groups.length, uri.fsPath)
      );
    }),

    vscode.commands.registerCommand(COMMANDS.importGroups, async () => {
      const pick = await vscode.window.showOpenDialog({
        title: getLocalization(LocalizationKeys.importOpenDialogTitle),
        openLabel: getLocalization(LocalizationKeys.importOpenDialogLabel),
        canSelectMany: false,
        filters: { JSON: ['json'] }
      });
      if (!pick || pick.length === 0) return;
      let parsed;
      try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(pick[0])).toString('utf8');
        parsed = parseImport(raw);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
          getLocalization(LocalizationKeys.importInvalidFile, message)
        );
        return;
      }
      const result = await applyImport(parsed, deps.settings, async existing => {
        const overwrite = getLocalization(LocalizationKeys.importConflictOverwrite);
        const skip = getLocalization(LocalizationKeys.importConflictSkip);
        const skipAll = getLocalization(LocalizationKeys.importConflictSkipAll);
        const choice = await vscode.window.showWarningMessage(
          getLocalization(LocalizationKeys.importConflictPrompt, existing.label),
          { modal: true },
          overwrite,
          skip,
          skipAll
        );
        const map: Record<string, ImportConflictStrategy> = {
          [overwrite]: 'overwrite',
          [skip]: 'skip',
          [skipAll]: 'skip-all'
        };
        return map[choice ?? ''] ?? 'skip';
      });
      deps.tree.refresh();
      const skippedSuffix = result.skipped.length ? ` · ${result.skipped.length} skipped` : '';
      void vscode.window.showInformationMessage(
        getLocalization(
          LocalizationKeys.importSummary,
          result.imported.length,
          skippedSuffix
        )
      );
    })
  );
};
