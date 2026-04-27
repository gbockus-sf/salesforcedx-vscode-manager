export const EXTENSION_ID = 'salesforce.salesforcedx-vscode-manager';
export const COMMAND_CATEGORY = 'SFDX Manager';
export const CONFIG_NAMESPACE = 'salesforcedx-vscode-manager';

export const VIEW_CONTAINER_ID = 'sfdxManager';
export const VIEW_GROUPS_ID = 'sfdxManager.groups';
export const VIEW_DEPENDENCIES_ID = 'sfdxManager.dependencies';
export const VIEW_VSIX_ID = 'sfdxManager.vsix';

/**
 * VSCode context keys toggled from `executeCommand('setContext', ...)`.
 * Kept in one place so view `when` clauses and runtime
 * `setContext` calls can't drift apart.
 */
export const CONTEXT_KEYS = {
  anyBusy: 'sfdxManager.anyBusy',
  hasVsixOverrides: 'sfdxManager.hasVsixOverrides'
} as const;

export const COMMANDS = {
  applyGroup: 'sfdxManager.applyGroup',
  applyGroupQuickPick: 'sfdxManager.applyGroupQuickPick',
  enableAllSalesforce: 'sfdxManager.enableAllSalesforce',
  disableAllSalesforce: 'sfdxManager.disableAllSalesforce',
  createCustomGroup: 'sfdxManager.createCustomGroup',
  editGroup: 'sfdxManager.editGroup',
  deleteGroup: 'sfdxManager.deleteGroup',
  openGroupsConfig: 'sfdxManager.openGroupsConfig',
  showDependencies: 'sfdxManager.showDependencies',
  runDependencyCheck: 'sfdxManager.runDependencyCheck',
  copyDependencyReport: 'sfdxManager.copyDependencyReport',
  refreshFromVsixDirectory: 'sfdxManager.refreshFromVsixDirectory',
  openVsixDirectory: 'sfdxManager.openVsixDirectory',
  clearVsixOverrides: 'sfdxManager.clearVsixOverrides',
  vsixMenu: 'sfdxManager.vsixMenu',
  removeVsixOverride: 'sfdxManager.removeVsixOverride',
  revealVsixFile: 'sfdxManager.revealVsixFile',
  upgradeCli: 'sfdxManager.upgradeCli',
  refreshCliVersion: 'sfdxManager.refreshCliVersion',
  showLog: 'sfdxManager.showLog',
  updateExtension: 'sfdxManager.updateExtension',
  updateAllSalesforce: 'sfdxManager.updateAllSalesforce',
  checkForUpdates: 'sfdxManager.checkForUpdates',
  exportGroups: 'sfdxManager.exportGroups',
  importGroups: 'sfdxManager.importGroups',
  moveGroupScope: 'sfdxManager.moveGroupScope',
  browseSalesforceExtensions: 'sfdxManager.browseSalesforceExtensions',
  refreshSalesforceCatalog: 'sfdxManager.refreshSalesforceCatalog',
  installExtension: 'sfdxManager.installExtension',
  uninstallExtension: 'sfdxManager.uninstallExtension',
  openInMarketplace: 'sfdxManager.openInMarketplace'
} as const;

export const SETTINGS = {
  groups: 'groups',
  applyScope: 'applyScope',
  backend: 'backend',
  autoRunDependencyChecks: 'autoRunDependencyChecks',
  thirdPartyExtensionIds: 'thirdPartyExtensionIds',
  vsixDirectory: 'vsixDirectory',
  vsixAutoInstall: 'vsixAutoInstall',
  statusBarShowGroup: 'statusBar.showGroup',
  statusBarShowVsix: 'statusBar.showVsix',
  statusBarShowCliUpdate: 'statusBar.showCliUpdate',
  updateCheck: 'updateCheck',
  reloadAfterApply: 'reloadAfterApply'
} as const;

export const CORE_EXTENSION_ID = 'salesforce.salesforcedx-vscode-core';

export type UpdateCheckMode = 'onStartup' | 'manual' | 'never';
export type ReloadAfterApplyMode = 'auto' | 'prompt' | 'never';

export const WORKSPACE_STATE = {
  activeGroupId: 'sfdxManager.activeGroupId',
  installSource: 'sfdxManager.installSource',
  applyScopeChoice: 'sfdxManager.applyScopeChoice'
} as const;

export const SALESFORCE_PUBLISHER = 'salesforce';

export const DEFAULT_THIRD_PARTY_EXTENSION_IDS: readonly string[] = [
  'redhat.vscode-xml',
  'dbaeumer.vscode-eslint',
  'esbenp.prettier-vscode'
];
