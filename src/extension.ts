import * as vscode from 'vscode';
import { registerDependencyCommands } from './commands/dependencyCommands';
import { registerGroupCommands } from './commands/groupCommands';
import { COMMANDS, VIEW_DEPENDENCIES_ID, VIEW_GROUPS_ID } from './constants';
import { DependencyRegistry } from './dependencies/registry';
import { DependencyRunners } from './dependencies/runners';
import { GroupStore } from './groups/groupStore';
import { CodeCliService } from './services/codeCliService';
import { ExtensionService } from './services/extensionService';
import { ProcessService } from './services/processService';
import { SettingsService } from './services/settingsService';
import { WorkspaceStateService } from './services/workspaceStateService';
import { Logger } from './util/logger';
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

  const groupsTree = new GroupsTreeProvider(store, extensions, workspaceState);
  const dependenciesTree = new DependenciesTreeProvider(registry);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_GROUPS_ID, groupsTree),
    vscode.window.registerTreeDataProvider(VIEW_DEPENDENCIES_ID, dependenciesTree),
    settings.onDidChange(() => {
      groupsTree.refresh();
      dependenciesTree.refresh();
    })
  );

  registerGroupCommands(context, {
    store,
    extensions,
    settings,
    workspaceState,
    logger,
    tree: groupsTree
  });

  registerDependencyCommands(context, {
    registry,
    tree: dependenciesTree,
    logger
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
