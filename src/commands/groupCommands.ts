import * as vscode from 'vscode';
import { COMMANDS, CONFIG_NAMESPACE, SETTINGS } from '../constants';
import { applyGroup } from '../groups/groupApplier';
import type { GroupStore } from '../groups/groupStore';
import type { ApplyScope, Group } from '../groups/types';
import type { ExtensionService } from '../services/extensionService';
import type { SettingsService } from '../services/settingsService';
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
      { label: 'Enable members, disable others', scope: 'disableOthers' as const },
      { label: 'Enable members only', scope: 'enableOnly' as const }
    ],
    { placeHolder: `How should "${group.label}" be applied?` }
  );
  if (!choice) return undefined;
  await workspaceState.setApplyScopeChoice(group.id, choice.scope);
  return choice.scope;
};

const runApply = async (group: Group, deps: Deps): Promise<void> => {
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
      `manualDisable=${result.needsManualDisable.length} skipped=${result.skipped.length}`
  );

  const parts: string[] = [`${group.label} applied.`, `Enabled: ${result.enabled.length}`];
  if (result.disabled.length) parts.push(`Disabled: ${result.disabled.length}`);
  if (result.installedFromVsix.length) parts.push(`VSIX: ${result.installedFromVsix.length}`);
  if (result.needsManualEnable.length) parts.push(`Manual enable: ${result.needsManualEnable.length}`);
  if (result.needsManualDisable.length) parts.push(`Manual disable: ${result.needsManualDisable.length}`);
  if (result.skipped.length) parts.push(`Skipped: ${result.skipped.length}`);

  const hasFollowUp = result.needsManualEnable.length + result.needsManualDisable.length > 0;
  const logAction = 'Show log';
  const choice = await vscode.window.showInformationMessage(
    parts.join(' · '),
    ...(hasFollowUp ? [logAction] : [logAction])
  );
  if (choice === logAction) deps.logger.show();

  if (result.needsManualDisable.length) {
    await deps.extensions.showManualToggleHint(result.needsManualDisable, 'Disable');
  } else if (result.needsManualEnable.length) {
    await deps.extensions.showManualToggleHint(result.needsManualEnable, 'Enable');
  }
};

const pickGroup = async (deps: Deps, placeholder: string): Promise<Group | undefined> => {
  const groups = deps.store.list();
  const choice = await vscode.window.showQuickPick(
    groups.map(g => ({
      label: g.label,
      description: g.builtIn ? 'built-in' : 'custom',
      detail: g.description,
      group: g
    })),
    { placeHolder: placeholder }
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
    placeHolder: 'Pick the extensions that belong to this group.'
  });
  if (!picks) return undefined;
  return picks.map(p => p.label);
};

export const registerGroupCommands = (context: vscode.ExtensionContext, deps: Deps): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      COMMANDS.applyGroupQuickPick,
      async () => {
        const group = await pickGroup(deps, 'Apply which group?');
        if (group) await runApply(group, deps);
      }
    ),

    vscode.commands.registerCommand(
      COMMANDS.applyGroup,
      async (arg?: string | GroupTreeContext) => {
        let group: Group | undefined;
        if (typeof arg === 'string') group = deps.store.get(arg);
        else if (arg && 'group' in arg && arg.group) group = arg.group;
        else group = await pickGroup(deps, 'Apply which group?');
        if (group) await runApply(group, deps);
      }
    ),

    vscode.commands.registerCommand(COMMANDS.enableAllSalesforce, async () => {
      const ids = deps.extensions.managed().map(e => e.id);
      for (const id of ids) await deps.extensions.enable(id);
      deps.tree.refresh();
      void vscode.window.showInformationMessage(`Enabled ${ids.length} managed extensions.`);
    }),

    vscode.commands.registerCommand(COMMANDS.disableAllSalesforce, async () => {
      const ids = deps.extensions.managed().map(e => e.id);
      for (const id of ids) await deps.extensions.disable(id);
      await deps.workspaceState.setActiveGroupId(undefined);
      deps.tree.refresh();
      void vscode.window.showInformationMessage(`Disabled ${ids.length} managed extensions.`);
    }),

    vscode.commands.registerCommand(COMMANDS.createCustomGroup, async () => {
      const id = await vscode.window.showInputBox({
        prompt: 'Id for the new group (lowercase, no spaces)',
        validateInput: v =>
          !v?.match(/^[a-z][a-z0-9-]*$/)
            ? 'Must start with a letter; only lowercase letters, digits, and dashes.'
            : deps.store.get(v)
              ? `A group with id "${v}" already exists.`
              : undefined
      });
      if (!id) return;
      const label = await vscode.window.showInputBox({ prompt: 'Display label' });
      if (!label) return;
      const members = await pickMembers(deps);
      if (members === undefined) return;
      await deps.store.upsert({ id, label, extensions: members });
      deps.tree.refresh();
      void vscode.window.showInformationMessage(`Group "${label}" created with ${members.length} extensions.`);
    }),

    vscode.commands.registerCommand(
      COMMANDS.editGroup,
      async (arg?: string | GroupTreeContext) => {
        let group: Group | undefined;
        if (typeof arg === 'string') group = deps.store.get(arg);
        else if (arg && 'group' in arg && arg.group) group = arg.group;
        else group = await pickGroup(deps, 'Edit which group?');
        if (!group) return;

        const members = await pickMembers(deps, group.extensions);
        if (members === undefined) return;
        await deps.store.upsert({ ...group, extensions: members });
        deps.tree.refresh();
        void vscode.window.showInformationMessage(`Group "${group.label}" updated.`);
      }
    ),

    vscode.commands.registerCommand(
      COMMANDS.deleteGroup,
      async (arg?: string | GroupTreeContext) => {
        let group: Group | undefined;
        if (typeof arg === 'string') group = deps.store.get(arg);
        else if (arg && 'group' in arg && arg.group) group = arg.group;
        else group = await pickGroup(deps, 'Delete (or reset) which group?');
        if (!group) return;
        const verb = group.builtIn ? 'Reset to default' : 'Delete';
        const confirm = await vscode.window.showWarningMessage(
          `${verb} group "${group.label}"?`,
          { modal: true },
          verb
        );
        if (confirm !== verb) return;
        await deps.store.remove(group.id);
        deps.tree.refresh();
        void vscode.window.showInformationMessage(`${group.label}: ${verb.toLowerCase()} done.`);
      }
    ),

    vscode.commands.registerCommand(COMMANDS.openGroupsConfig, async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        `${CONFIG_NAMESPACE}.${SETTINGS.groups}`
      );
    })
  );
};
