import * as vscode from 'vscode';
import { VIEW_DEPENDENCIES_ID, VIEW_GROUPS_ID } from './constants';
import { CodeCliService } from './services/codeCliService';
import { ExtensionService } from './services/extensionService';
import { ProcessService } from './services/processService';
import { SettingsService } from './services/settingsService';
import { WorkspaceStateService } from './services/workspaceStateService';
import { Logger } from './util/logger';

interface PlaceholderNode {
  label: string;
}

class PlaceholderTreeProvider implements vscode.TreeDataProvider<PlaceholderNode> {
  constructor(private readonly message: string) {}

  getTreeItem(element: PlaceholderNode): vscode.TreeItem {
    return new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
  }

  getChildren(): PlaceholderNode[] {
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
  const extensionService = new ExtensionService(settings, codeCli, logger);

  // Keep references so the unused-parameter lint rule doesn't fire while real
  // wiring lands in later phases.
  void workspaceState;
  void extensionService;

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      VIEW_GROUPS_ID,
      new PlaceholderTreeProvider('Groups load in Phase 5.')
    ),
    vscode.window.registerTreeDataProvider(
      VIEW_DEPENDENCIES_ID,
      new PlaceholderTreeProvider('Dependency checks land in Phase 7.')
    )
  );

  logger.info('Salesforce Extensions Manager activated.');
};

export const deactivate = (): void => {
  // no-op
};
