import * as vscode from 'vscode';
import { registerDependencyCommands } from './commands/dependencyCommands';
import { registerGroupCommands } from './commands/groupCommands';
import { registerVsixCommands } from './commands/vsixCommands';
import { COMMANDS, CONFIG_NAMESPACE, SETTINGS, VIEW_DEPENDENCIES_ID, VIEW_GROUPS_ID } from './constants';
import { DependencyRegistry } from './dependencies/registry';
import { DependencyRunners } from './dependencies/runners';
import { GroupStore } from './groups/groupStore';
import { CodeCliService } from './services/codeCliService';
import { ExtensionService } from './services/extensionService';
import { ProcessService } from './services/processService';
import { SettingsService } from './services/settingsService';
import { WorkspaceStateService } from './services/workspaceStateService';
import { Logger } from './util/logger';
import { GroupStatusBarItem } from './statusBar/groupStatusBarItem';
import { VsixStatusBarItem } from './statusBar/vsixStatusBarItem';
import { VsixInstaller } from './vsix/vsixInstaller';
import { VsixScanner } from './vsix/vsixScanner';
import { DependenciesTreeProvider } from './views/dependenciesTreeProvider';
import { GroupsTreeProvider } from './views/groupsTreeProvider';

export const activate = (context: vscode.ExtensionContext): void => {
  const logger = new Logger('Salesforce Extensions Manager');
  context.subscriptions.push({ dispose: () => logger.dispose() });

  const settings = new SettingsService();
  const proc = new ProcessService();
  const codeCli = new CodeCliService(proc);
  const workspaceState = new WorkspaceStateService(context);
  const extensions = new ExtensionService(settings, codeCli, logger);
  const store = new GroupStore(settings);

  const runners = new DependencyRunners(proc);
  const registry = new DependencyRegistry(runners);

  let scanner = new VsixScanner(settings.getVsixDirectory());
  let installer = new VsixInstaller(scanner, codeCli, workspaceState, logger);
  extensions.setVsixInstaller(installer);

  const groupsTree = new GroupsTreeProvider(store, extensions, workspaceState);
  groupsTree.setVsixSources(() => installer.currentSources());
  groupsTree.setVsixOverrides(() => installer.vsixOverrides());
  const dependenciesTree = new DependenciesTreeProvider(registry);

  const groupStatusBar = new GroupStatusBarItem(store, workspaceState, settings);
  const vsixStatusBar = new VsixStatusBarItem(settings, installer);
  context.subscriptions.push(groupStatusBar, vsixStatusBar);

  let vsixWatcher: vscode.Disposable | undefined = scanner.watch(() => {
    groupsTree.refresh();
    vsixStatusBar.update();
  });
  if (vsixWatcher) context.subscriptions.push(vsixWatcher);

  if (scanner.isConfigured() && !scanner.exists()) {
    void vscode.window
      .showWarningMessage(
        `VSIX directory "${scanner.getDirectory()}" does not exist.`,
        'Open Settings'
      )
      .then(choice => {
        if (choice === 'Open Settings') {
          void vscode.commands.executeCommand(
            'workbench.action.openSettings',
            `${CONFIG_NAMESPACE}.${SETTINGS.vsixDirectory}`
          );
        }
      });
  }

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_GROUPS_ID, groupsTree),
    vscode.window.registerTreeDataProvider(VIEW_DEPENDENCIES_ID, dependenciesTree),
    settings.onDidChange(e => {
      if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.${SETTINGS.vsixDirectory}`)) {
        vsixWatcher?.dispose();
        scanner = new VsixScanner(settings.getVsixDirectory());
        installer = new VsixInstaller(scanner, codeCli, workspaceState, logger);
        extensions.setVsixInstaller(installer);
        groupsTree.setVsixSources(() => installer.currentSources());
        groupsTree.setVsixOverrides(() => installer.vsixOverrides());
        vsixStatusBar.setInstaller(installer);
        vsixWatcher = scanner.watch(() => {
          groupsTree.refresh();
          vsixStatusBar.update();
        });
        if (vsixWatcher) context.subscriptions.push(vsixWatcher);
      }
      groupsTree.refresh();
      dependenciesTree.refresh();
      groupStatusBar.update();
      vsixStatusBar.update();
    })
  );

  registerGroupCommands(context, {
    store,
    extensions,
    settings,
    workspaceState,
    logger,
    tree: groupsTree,
    onAfterApply: () => {
      groupStatusBar.update();
      vsixStatusBar.update();
    }
  });

  registerDependencyCommands(context, {
    registry,
    tree: dependenciesTree,
    logger
  });

  registerVsixCommands(context, {
    scanner,
    installer,
    extensions,
    settings,
    workspaceState,
    logger,
    groupsTree
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.showLog, () => logger.show())
  );

  if (settings.getAutoRunDependencyChecks()) {
    void dependenciesTree.runChecks();
  }

  logger.info('Salesforce Extensions Manager activated.');
};

export const deactivate = (): void => {
  // no-op
};
