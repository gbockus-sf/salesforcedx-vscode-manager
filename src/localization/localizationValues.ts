/**
 * Copyright (c) 2026 Salesforce, Inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 **/

import { LocalizationKeys } from './localizationKeys';

/**
 * Default English values for every `LocalizationKeys` entry. These strings
 * are what `vscode.l10n.t(...)` looks up; translations live in
 * `l10n/bundle.l10n.<locale>.json` keyed by the *source string* (VSCode's
 * convention, not our enum values).
 *
 * Positional placeholders use `{0}`, `{1}`, ... as VSCode's `l10n.t` expects.
 */
export const localizationValues: Record<LocalizationKeys, string> = {
  [LocalizationKeys.showLog]: 'Show Log',
  [LocalizationKeys.notifyDismiss]: 'Dismiss',

  [LocalizationKeys.applyScopePromptPlaceholder]: 'How should "{0}" be applied?',
  [LocalizationKeys.applyScopeDisableOthers]: 'Enable members, disable others',
  [LocalizationKeys.applyScopeEnableOnly]: 'Enable members only',

  [LocalizationKeys.applySummaryApplied]: '{0} applied.',
  [LocalizationKeys.applySummaryEnabled]: 'Enabled: {0}',
  [LocalizationKeys.applySummaryDisabled]: 'Disabled: {0}',
  [LocalizationKeys.applySummaryVsix]: 'VSIX: {0}',
  [LocalizationKeys.applySummaryDepAutoIncluded]: 'Dep auto-included: {0}',
  [LocalizationKeys.applySummaryDepBlocked]: 'Dep-blocked: {0}',
  [LocalizationKeys.applySummaryManualEnable]: 'Manual enable: {0}',
  [LocalizationKeys.applySummaryManualDisable]: 'Manual disable: {0}',
  [LocalizationKeys.applySummarySkipped]: 'Skipped: {0}',

  [LocalizationKeys.reloadAfterApplyPrompt]: 'Apply complete. Reload window to activate changes?',
  [LocalizationKeys.reloadAfterApplyAction]: 'Reload Window',

  [LocalizationKeys.pickGroupDefaultPrompt]: 'Apply which group?',
  [LocalizationKeys.createGroupIdPrompt]: 'Id for the new group (lowercase, no spaces)',
  [LocalizationKeys.createGroupIdValidationFormat]: 'Must start with a letter; only lowercase letters, digits, and dashes.',
  [LocalizationKeys.createGroupIdValidationDuplicate]: 'A group with id "{0}" already exists.',
  [LocalizationKeys.createGroupLabelPrompt]: 'Display label',
  [LocalizationKeys.pickMembersPlaceholder]: 'Pick the extensions that belong to this group.',
  [LocalizationKeys.createGroupSuccess]: 'Group "{0}" created with {1} extensions.',
  [LocalizationKeys.editGroupSuccess]: 'Group "{0}" updated.',
  [LocalizationKeys.deleteGroupConfirm]: '{0} group "{1}"?',
  [LocalizationKeys.deleteGroupVerbDelete]: 'Delete',
  [LocalizationKeys.deleteGroupVerbReset]: 'Reset to default',
  [LocalizationKeys.deleteGroupDoneDelete]: '{0}: deleted.',
  [LocalizationKeys.deleteGroupDoneReset]: '{0}: reset to default.',
  [LocalizationKeys.enableAllDone]: 'Enabled {0} managed extensions.',
  [LocalizationKeys.disableAllDone]: 'Disabled {0} managed extensions.',
  [LocalizationKeys.groupBuiltIn]: 'built-in',
  [LocalizationKeys.groupCustom]: 'custom',
  [LocalizationKeys.groupActive]: 'active',
  [LocalizationKeys.extensionNotInstalled]: 'not installed',
  [LocalizationKeys.extensionDisabled]: 'disabled',
  [LocalizationKeys.extensionVsixBadge]: 'vsix',
  [LocalizationKeys.extensionUpdateBadge]: 'update → v{0}',
  [LocalizationKeys.extensionInstalledLine]: 'Installed: v{0}',
  [LocalizationKeys.extensionMarketplaceUpdateLine]: 'Marketplace: v{0} (update available)',
  [LocalizationKeys.extensionVsixTooltip]: 'Installed from local VSIX: {0}',
  [LocalizationKeys.extensionVsixTooltipGeneric]: 'Installed from local VSIX directory',
  [LocalizationKeys.extensionVsixWalkthroughHint]: 'See resources/walkthrough/vsix.md for the VSIX workflow.',
  [LocalizationKeys.extensionVsixAvailableBadge]: 'vsix available',
  [LocalizationKeys.extensionVsixAvailableTooltip]: 'Local VSIX available: {0} · Install this row to use it.',
  [LocalizationKeys.extensionVsixLockedBadge]: 'vsix-managed',
  [LocalizationKeys.extensionVsixLockedTooltip]: 'Managed by local VSIX: {0} · To change, edit the VSIX override directory.',
  [LocalizationKeys.vsixTreeNodeDescription]: 'v{0} · {1}',
  [LocalizationKeys.vsixTreeNodeTooltip]: '{0}\nv{1}\nSource: {2}',
  [LocalizationKeys.vsixRemoveConfirm]: 'Delete VSIX file "{0}" from the override directory? The extension will stay installed but will no longer be VSIX-managed.',
  [LocalizationKeys.vsixRemoveProceed]: 'Delete VSIX File',
  [LocalizationKeys.vsixAutoInstallSummary]: 'Auto-installed {0} VSIX override(s).',
  [LocalizationKeys.vsixAutoInstallFailed]: 'Auto-install failed for {0} VSIX override(s). See the log for details.',
  [LocalizationKeys.dependencyChildDep]: 'dependency',
  [LocalizationKeys.dependencyChildPack]: 'pack member',
  [LocalizationKeys.dependencyChildEnabled]: 'enabled',
  [LocalizationKeys.dependencyChildDisabled]: 'disabled',
  [LocalizationKeys.dependencyChildNotInstalled]: 'not installed',

  [LocalizationKeys.vsixDirectoryNotConfigured]: 'VSIX directory is not configured.',
  [LocalizationKeys.vsixDirectoryNotConfiguredOpenSettings]: 'Open Settings',
  [LocalizationKeys.vsixNoFilesFound]: 'No .vsix files found in {0}.',
  [LocalizationKeys.vsixReinstallProgressTitle]: 'Reinstalling from VSIX directory…',
  [LocalizationKeys.vsixRefreshSummaryOk]: 'Refreshed from VSIX directory: {0} installed.',
  [LocalizationKeys.vsixRefreshSummaryFailed]: 'Refreshed from VSIX directory: {0} installed · {1} failed.',
  [LocalizationKeys.vsixNoOverrides]: 'No VSIX-sourced extensions to clear.',
  [LocalizationKeys.vsixClearConfirm]: 'Uninstall {0} VSIX-sourced extension(s) and reinstall from marketplace?',
  [LocalizationKeys.vsixClearProceed]: 'Proceed',
  [LocalizationKeys.vsixReinstalledFromMarketplace]: 'Reinstalled {0} extension(s) from marketplace.',
  [LocalizationKeys.vsixMenuOpenConfigured]: '$(folder) Open VSIX Directory',
  [LocalizationKeys.vsixMenuOpenUnconfigured]: '$(gear) Configure VSIX Directory',
  [LocalizationKeys.vsixMenuNotSet]: 'not set',
  [LocalizationKeys.vsixMenuRefresh]: '$(refresh) Refresh from VSIX Directory',
  [LocalizationKeys.vsixMenuClear]: '$(trash) Clear VSIX Overrides',
  [LocalizationKeys.vsixMenuChange]: '$(gear) Change VSIX Directory...',
  [LocalizationKeys.vsixMenuPlaceholder]: 'VSIX management',

  [LocalizationKeys.updateRequiresNode]: 'SFDX Manager: Update requires an extension node to be selected in the Groups tree.',
  [LocalizationKeys.updateFailed]: 'Failed to update {0}. See SFDX Manager log.',
  [LocalizationKeys.updateSucceeded]: 'Updated {0}.',
  [LocalizationKeys.updateAllNone]: 'No managed extensions to update.',
  [LocalizationKeys.updateAllProgressTitle]: 'Updating managed Salesforce extensions…',
  [LocalizationKeys.updateAllSummaryOk]: 'Update complete: {0} succeeded.',
  [LocalizationKeys.updateAllSummaryFailed]: 'Update complete: {0} succeeded · {1} failed.',
  [LocalizationKeys.checkForUpdatesDone]: 'SFDX Manager: update check complete.',

  [LocalizationKeys.depsProgressTitle]: 'Checking dependencies…',
  [LocalizationKeys.depsSummary]: 'Dependencies: {0}',
  [LocalizationKeys.depReportCopied]: 'Dependency report copied to clipboard.',
  [LocalizationKeys.depsShowAction]: 'Show Dependencies',

  [LocalizationKeys.depCategoryCli]: 'CLIs',
  [LocalizationKeys.depCategoryRuntime]: 'Runtimes',
  [LocalizationKeys.depCategoryPerExtension]: 'Per-Extension',
  [LocalizationKeys.depStateNotRunYet]: 'not run yet',
  [LocalizationKeys.depRequiredBy]: 'Required by: {0}',
  [LocalizationKeys.depFixLabel]: 'Fix: {0}',

  [LocalizationKeys.manualToggleHint]: '{0} the {1} extension(s) shown in the Extensions view.',

  [LocalizationKeys.vsixDirectoryMissingWarn]: 'VSIX directory "{0}" does not exist.',
  [LocalizationKeys.openSettingsAction]: 'Open Settings',

  [LocalizationKeys.statusGroupText]: '$(layers) {0}',
  [LocalizationKeys.statusGroupNone]: 'None',
  [LocalizationKeys.statusGroupTooltipActive]: 'Active SFDX group: {0} — click to switch',
  [LocalizationKeys.statusGroupTooltipNone]: 'No SFDX group applied — click to pick one',
  [LocalizationKeys.statusVsixText]: '$(package) VSIX: {0}',
  [LocalizationKeys.statusVsixTooltipActive]: '{0} extension(s) loaded from {1} — click to manage.',
  [LocalizationKeys.statusVsixTooltipIdle]: 'VSIX directory: {0} — no overrides active. Click to manage.',

  [LocalizationKeys.validateGroupBadId]: 'Group id must start with a letter and contain only lowercase letters, digits, and dashes.',
  [LocalizationKeys.validateGroupMissingLabel]: 'Group label is required.',
  [LocalizationKeys.validateGroupEmpty]: 'Group "{0}" is empty. Add at least one extension before saving.',

  [LocalizationKeys.groupNotFound]: 'Group "{0}" not found.',

  [LocalizationKeys.exportSaveDialogTitle]: 'Export SFDX Manager Groups',
  [LocalizationKeys.exportSaveDialogLabel]: 'Export Groups',
  [LocalizationKeys.exportSuccess]: 'Exported {0} group(s) to {1}.',
  [LocalizationKeys.exportNoUserGroups]: 'No user-defined groups to export. Built-in groups are already shipped in code.',
  [LocalizationKeys.importOpenDialogTitle]: 'Import SFDX Manager Groups',
  [LocalizationKeys.importOpenDialogLabel]: 'Import',
  [LocalizationKeys.importInvalidFile]: 'Import failed: {0}',
  [LocalizationKeys.importSummary]: 'Imported {0} group(s){1}.',
  [LocalizationKeys.importConflictPrompt]: 'A group with id "{0}" already exists. Overwrite it?',
  [LocalizationKeys.importConflictOverwrite]: 'Overwrite',
  [LocalizationKeys.importConflictSkip]: 'Skip',
  [LocalizationKeys.importConflictSkipAll]: 'Skip All Conflicts',

  [LocalizationKeys.moveGroupScopePrompt]: 'Move "{0}" to which scope?',
  [LocalizationKeys.moveGroupScopeToUser]: 'User (applies everywhere)',
  [LocalizationKeys.moveGroupScopeToWorkspace]: 'Workspace (only this workspace)',
  [LocalizationKeys.moveGroupScopeBuiltInError]: 'Built-in groups cannot be moved. Create an override first with Edit Group.',
  [LocalizationKeys.moveGroupScopeDone]: '{0} moved to {1} scope.',
  [LocalizationKeys.scopeBadgeUser]: 'user',
  [LocalizationKeys.scopeBadgeWorkspace]: 'workspace',

  [LocalizationKeys.groupExtensionPack]: 'extension pack',

  [LocalizationKeys.groupCatalog]: 'marketplace catalog',

  [LocalizationKeys.browsePlaceholder]: 'Pick Salesforce extensions to install.',
  [LocalizationKeys.browseEmpty]: 'Salesforce catalog is empty — run SFDX Manager: Refresh Salesforce Catalog first.',
  [LocalizationKeys.browseInstallProgress]: 'Installing selected extensions…',
  [LocalizationKeys.browseInstallSummaryOk]: 'Installed {0} extension(s).',
  [LocalizationKeys.browseInstallSummaryFailed]: 'Installed {0} extension(s) · {1} failed. See SFDX Manager log.',
  [LocalizationKeys.refreshCatalogDone]: 'Salesforce catalog: {0} extensions cached.',
  [LocalizationKeys.refreshCatalogEmpty]: 'Salesforce catalog refresh returned no results (offline?).',

  [LocalizationKeys.catalogNeedsRefresh]: 'refresh to load',

  [LocalizationKeys.installExtensionRequiresNode]: 'SFDX Manager: Install requires an extension node to be selected in the Groups tree.',
  [LocalizationKeys.installExtensionFailed]: 'Failed to install {0}. See SFDX Manager log.',
  [LocalizationKeys.installExtensionSucceeded]: 'Installed {0}.',
  [LocalizationKeys.installExtensionAlreadyInstalled]: '{0} is already installed.',
  [LocalizationKeys.uninstallExtensionConfirm]: 'Uninstall {0}?',
  [LocalizationKeys.uninstallExtensionProceed]: 'Uninstall',
  [LocalizationKeys.uninstallExtensionFailed]: 'Failed to uninstall {0}. See SFDX Manager log.',
  [LocalizationKeys.uninstallExtensionSucceeded]: 'Uninstalled {0}.',
  [LocalizationKeys.uninstallExtensionSucceededCascade]: 'Uninstalled {0} and {1} dependent extension(s).',
  [LocalizationKeys.uninstallExtensionNotInstalled]: '{0} is not installed.',
  [LocalizationKeys.uninstallExtensionCascadeConfirm]:
    '{0} is required by {1} other installed extension(s): {2}. Uninstalling it will also uninstall those. Continue?',
  [LocalizationKeys.uninstallExtensionPartialCascade]:
    'Uninstalled {0} of {1} extensions. Some uninstalls failed — see SFDX Manager log.',

  [LocalizationKeys.catalogCannotApplyAsGroup]: 'The marketplace catalog has too many extensions to apply as a single group. Install what you need via the Install button on each extension, or use "SFDX Manager: Browse Salesforce Extensions..." for a filtered Quick Pick.',

  [LocalizationKeys.openInMarketplaceRequiresNode]: 'SFDX Manager: Open in Marketplace requires an extension node to be selected in the Groups tree.',

  [LocalizationKeys.extensionLockedBadge]: 'required',
  [LocalizationKeys.extensionLockedTooltip]: 'Required by Salesforce Extensions Manager — install and uninstall are disabled.',
  [LocalizationKeys.uninstallExtensionLocked]: 'Cannot uninstall {0} — required by Salesforce Extensions Manager.'
};
