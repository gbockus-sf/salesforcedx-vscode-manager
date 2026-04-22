export const EXTENSION_ID = 'salesforce.salesforcedx-vscode-manager';
export const COMMAND_CATEGORY = 'SFDX Manager';
export const CONFIG_NAMESPACE = 'salesforcedx-vscode-manager';

export const VIEW_CONTAINER_ID = 'sfdxManager';
export const VIEW_GROUPS_ID = 'sfdxManager.groups';
export const VIEW_DEPENDENCIES_ID = 'sfdxManager.dependencies';

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
  showLog: 'sfdxManager.showLog'
} as const;

export const SETTINGS = {
  groups: 'groups',
  applyScope: 'applyScope',
  useInternalCommands: 'useInternalCommands',
  autoRunDependencyChecks: 'autoRunDependencyChecks',
  thirdPartyExtensionIds: 'thirdPartyExtensionIds',
  vsixDirectory: 'vsixDirectory',
  vsixAutoReinstallOnChange: 'vsixAutoReinstallOnChange',
  statusBarShowGroup: 'statusBar.showGroup',
  statusBarShowVsix: 'statusBar.showVsix'
} as const;

export const WORKSPACE_STATE = {
  activeGroupId: 'sfdxManager.activeGroupId',
  installSource: 'sfdxManager.installSource',
  applyScopeChoice: 'sfdxManager.applyScopeChoice'
} as const;

export const SALESFORCE_PUBLISHER = 'salesforce';

export const DEFAULT_THIRD_PARTY_EXTENSION_IDS: readonly string[] = [
  'redhat.vscode-xml',
  'dbaeumer.vscode-eslint',
  'esbenp.prettier-vscode',
  'salesforce.lightning-design-system-vscode'
];
