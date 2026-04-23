/**
 * Copyright (c) 2026 Salesforce, Inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 **/

/**
 * Central registry of every user-facing string key. Adding a new key here
 * requires adding its default English value to `localizationValues.ts`;
 * the unit test `test/unit/localization.test.ts` fails the build if any
 * key is missing a value.
 *
 * Keys are camelCase and grouped by feature area only by convention —
 * ordering doesn't affect runtime.
 */
export enum LocalizationKeys {
  // generic
  showLog = 'showLog',

  // apply scope picker
  applyScopePromptPlaceholder = 'applyScopePromptPlaceholder',
  applyScopeDisableOthers = 'applyScopeDisableOthers',
  applyScopeEnableOnly = 'applyScopeEnableOnly',

  // apply-group summary
  applySummaryApplied = 'applySummaryApplied',
  applySummaryEnabled = 'applySummaryEnabled',
  applySummaryDisabled = 'applySummaryDisabled',
  applySummaryVsix = 'applySummaryVsix',
  applySummaryDepAutoIncluded = 'applySummaryDepAutoIncluded',
  applySummaryDepBlocked = 'applySummaryDepBlocked',
  applySummaryManualEnable = 'applySummaryManualEnable',
  applySummaryManualDisable = 'applySummaryManualDisable',
  applySummarySkipped = 'applySummarySkipped',

  // reload prompt
  reloadAfterApplyPrompt = 'reloadAfterApplyPrompt',
  reloadAfterApplyAction = 'reloadAfterApplyAction',

  // group commands
  pickGroupDefaultPrompt = 'pickGroupDefaultPrompt',
  createGroupIdPrompt = 'createGroupIdPrompt',
  createGroupIdValidationFormat = 'createGroupIdValidationFormat',
  createGroupIdValidationDuplicate = 'createGroupIdValidationDuplicate',
  createGroupLabelPrompt = 'createGroupLabelPrompt',
  pickMembersPlaceholder = 'pickMembersPlaceholder',
  createGroupSuccess = 'createGroupSuccess',
  editGroupSuccess = 'editGroupSuccess',
  deleteGroupConfirm = 'deleteGroupConfirm',
  deleteGroupVerbDelete = 'deleteGroupVerbDelete',
  deleteGroupVerbReset = 'deleteGroupVerbReset',
  deleteGroupDoneDelete = 'deleteGroupDoneDelete',
  deleteGroupDoneReset = 'deleteGroupDoneReset',
  enableAllDone = 'enableAllDone',
  disableAllDone = 'disableAllDone',
  groupBuiltIn = 'groupBuiltIn',
  groupCustom = 'groupCustom',
  groupActive = 'groupActive',
  extensionNotInstalled = 'extensionNotInstalled',
  extensionDisabled = 'extensionDisabled',
  extensionVsixBadge = 'extensionVsixBadge',
  extensionUpdateBadge = 'extensionUpdateBadge',
  extensionInstalledLine = 'extensionInstalledLine',
  extensionMarketplaceUpdateLine = 'extensionMarketplaceUpdateLine',
  extensionVsixTooltip = 'extensionVsixTooltip',
  extensionVsixTooltipGeneric = 'extensionVsixTooltipGeneric',
  extensionVsixWalkthroughHint = 'extensionVsixWalkthroughHint',
  dependencyChildDep = 'dependencyChildDep',
  dependencyChildPack = 'dependencyChildPack',
  dependencyChildEnabled = 'dependencyChildEnabled',
  dependencyChildDisabled = 'dependencyChildDisabled',
  dependencyChildNotInstalled = 'dependencyChildNotInstalled',

  // vsix commands
  vsixDirectoryNotConfigured = 'vsixDirectoryNotConfigured',
  vsixDirectoryNotConfiguredOpenSettings = 'vsixDirectoryNotConfiguredOpenSettings',
  vsixNoFilesFound = 'vsixNoFilesFound',
  vsixReinstallProgressTitle = 'vsixReinstallProgressTitle',
  vsixRefreshSummaryOk = 'vsixRefreshSummaryOk',
  vsixRefreshSummaryFailed = 'vsixRefreshSummaryFailed',
  vsixNoOverrides = 'vsixNoOverrides',
  vsixClearConfirm = 'vsixClearConfirm',
  vsixClearProceed = 'vsixClearProceed',
  vsixReinstalledFromMarketplace = 'vsixReinstalledFromMarketplace',
  vsixMenuOpenConfigured = 'vsixMenuOpenConfigured',
  vsixMenuOpenUnconfigured = 'vsixMenuOpenUnconfigured',
  vsixMenuNotSet = 'vsixMenuNotSet',
  vsixMenuRefresh = 'vsixMenuRefresh',
  vsixMenuClear = 'vsixMenuClear',
  vsixMenuChange = 'vsixMenuChange',
  vsixMenuPlaceholder = 'vsixMenuPlaceholder',

  // update commands
  updateRequiresNode = 'updateRequiresNode',
  updateFailed = 'updateFailed',
  updateSucceeded = 'updateSucceeded',
  updateAllNone = 'updateAllNone',
  updateAllProgressTitle = 'updateAllProgressTitle',
  updateAllSummaryOk = 'updateAllSummaryOk',
  updateAllSummaryFailed = 'updateAllSummaryFailed',
  checkForUpdatesDone = 'checkForUpdatesDone',

  // dependency commands
  depsProgressTitle = 'depsProgressTitle',
  depsSummary = 'depsSummary',
  depReportCopied = 'depReportCopied',

  // dependencies tree
  depCategoryCli = 'depCategoryCli',
  depCategoryRuntime = 'depCategoryRuntime',
  depCategoryPerExtension = 'depCategoryPerExtension',
  depStateNotRunYet = 'depStateNotRunYet',
  depRequiredBy = 'depRequiredBy',
  depFixLabel = 'depFixLabel',

  // extension service
  manualToggleHint = 'manualToggleHint',

  // activation
  vsixDirectoryMissingWarn = 'vsixDirectoryMissingWarn',
  openSettingsAction = 'openSettingsAction',

  // status bar
  statusGroupText = 'statusGroupText',
  statusGroupNone = 'statusGroupNone',
  statusGroupTooltipActive = 'statusGroupTooltipActive',
  statusGroupTooltipNone = 'statusGroupTooltipNone',
  statusVsixText = 'statusVsixText',
  statusVsixTooltipActive = 'statusVsixTooltipActive',
  statusVsixTooltipIdle = 'statusVsixTooltipIdle',

  // group validation
  validateGroupBadId = 'validateGroupBadId',
  validateGroupMissingLabel = 'validateGroupMissingLabel',
  validateGroupEmpty = 'validateGroupEmpty',

  // group errors
  groupNotFound = 'groupNotFound',

  // import / export groups
  exportSaveDialogTitle = 'exportSaveDialogTitle',
  exportSaveDialogLabel = 'exportSaveDialogLabel',
  exportSuccess = 'exportSuccess',
  exportNoUserGroups = 'exportNoUserGroups',
  importOpenDialogTitle = 'importOpenDialogTitle',
  importOpenDialogLabel = 'importOpenDialogLabel',
  importInvalidFile = 'importInvalidFile',
  importSummary = 'importSummary',
  importConflictPrompt = 'importConflictPrompt',
  importConflictOverwrite = 'importConflictOverwrite',
  importConflictSkip = 'importConflictSkip',
  importConflictSkipAll = 'importConflictSkipAll',

  // scope commands
  moveGroupScopePrompt = 'moveGroupScopePrompt',
  moveGroupScopeToUser = 'moveGroupScopeToUser',
  moveGroupScopeToWorkspace = 'moveGroupScopeToWorkspace',
  moveGroupScopeBuiltInError = 'moveGroupScopeBuiltInError',
  moveGroupScopeDone = 'moveGroupScopeDone',
  scopeBadgeUser = 'scopeBadgeUser',
  scopeBadgeWorkspace = 'scopeBadgeWorkspace'
}
