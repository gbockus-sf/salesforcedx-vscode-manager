import * as vscode from 'vscode';
import { registerGroupCommands } from './commands/groupCommands';
import { VIEW_DEPENDENCIES_ID, VIEW_GROUPS_ID } from './constants';
import { GroupStore } from './groups/groupStore';
import { CodeCliService } from './services/codeCliService';
import { ExtensionService } from './services/extensionService';
import { ProcessService } from './services/processService';
import { SettingsService } from './services/settingsService';
import { WorkspaceStateService } from './services/workspaceStateService';
import { Logger } from './util/logger';
import { GroupsTreeProvider } from './views/groupsTreeProvider';

class PlaceholderTreeProvider implements vscode.TreeDataProvider<{ label: string }> {
  constructor(private readonly message: string) {}
  getTreeItem(element: { label: string }): vscode.TreeItem {
    return new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
  }
  getChildren(): { label: string }[] {
    return [{ label: this.message }];
  }
}

export const activate = (context: vscode.ExtensionContext): void => {
  const logger = new Logger('Salesforce Extensions Manager');
  context.subscriptions.push({ dispose: () => logger.dispose() });

  const settings = new SettingsService();
  const proc = new ProcessService();
  const codeCli = new CodeCliService(proc);
  const workspaceState = new WorkspaceStateService(context);
  const extensions = new ExtensionService(settings, codeCli, logger);
  const store = new GroupStore(settings);

  const groupsTree = new GroupsTreeProvider(store, extensions, workspaceState);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_GROUPS_ID, groupsTree),
    vscode.window.registerTreeDataProvider(
      VIEW_DEPENDENCIES_ID,
      new PlaceholderTreeProvider('Dependency checks land in Phase 7.')
    ),
    settings.onDidChange(() => groupsTree.refresh())
  );

  registerGroupCommands(context, {
    store,
    extensions,
    settings,
    workspaceState,
    logger,
    tree: groupsTree
  });

  logger.info('Salesforce Extensions Manager activated.');
};

export const deactivate = (): void => {
  // no-op
};
