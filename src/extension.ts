import * as vscode from 'vscode';
import { registerCatalogCommands } from './commands/catalogCommands';
import { registerDependencyCommands } from './commands/dependencyCommands';
import { registerGroupCommands } from './commands/groupCommands';
import { registerUpdateCommands } from './commands/updateCommands';
import { registerVsixCommands } from './commands/vsixCommands';
import { COMMANDS, CONFIG_NAMESPACE, SALESFORCE_PUBLISHER, SETTINGS, VIEW_DEPENDENCIES_ID, VIEW_GROUPS_ID } from './constants';
import { DependencyRegistry } from './dependencies/registry';
import { DependencyRunners } from './dependencies/runners';
import { GroupStore } from './groups/groupStore';
import { getLocalization, LocalizationKeys } from './localization';
import { CodeCliService } from './services/codeCliService';
import { ExtensionService } from './services/extensionService';
import { MarketplaceVersionService } from './services/marketplaceVersionService';
import { ProcessService } from './services/processService';
import { PublisherCatalogService } from './services/publisherCatalogService';
import { SettingsService } from './services/settingsService';
import { TelemetryService } from './services/telemetryService';
import { WorkspaceStateService } from './services/workspaceStateService';
import { BusyState } from './util/busyState';
import { Logger } from './util/logger';
import { GroupStatusBarItem } from './statusBar/groupStatusBarItem';
import { VsixStatusBarItem } from './statusBar/vsixStatusBarItem';
import { VsixInstaller } from './vsix/vsixInstaller';
import { VsixScanner } from './vsix/vsixScanner';
import { DependenciesTreeProvider } from './views/dependenciesTreeProvider';
import { GroupsTreeProvider } from './views/groupsTreeProvider';

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  const hrStart = process.hrtime();
  const logger = new Logger('Salesforce Extensions Manager');
  context.subscriptions.push({ dispose: () => logger.dispose() });

  // Telemetry first — subsequent services may emit from their own init.
  // init() swallows failures, so a missing core extension or crashed
  // reporter does NOT block activation; helpers just no-op.
  await TelemetryService.init(context, logger);

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

  const marketplaceProbe = new MarketplaceVersionService({ logger });
  extensions.setMarketplaceProbe(marketplaceProbe);
  extensions.setInstallSourceLookup(id => installer.currentSources()[id] ?? 'unknown');

  const publisherCatalog = new PublisherCatalogService(
    SALESFORCE_PUBLISHER,
    marketplaceProbe,
    settings,
    logger
  );
  store.setPublisherCatalog(() => ({
    publisher: publisherCatalog.getPublisher(),
    extensionIds: publisherCatalog.current().map(e => e.extensionId),
    loaded: publisherCatalog.isLoaded()
  }));

  // Wire the marketplace catalog as a fallback display-name source so
  // uninstalled ids (the bulk of the "All Salesforce Extensions" group)
  // render as their real names like "Agentforce Vibes". Routed through
  // the service so the tree AND notification copy share one resolver.
  extensions.setCatalogDisplayNameLookup(id =>
    publisherCatalog.current().find(e => e.extensionId === id)?.displayName
  );

  /**
   * Build the id set the scanner uses for prefix-based VSIX matching.
   * It must include EVERY extension id the manager knows about — not
   * just `managed()` (which is the *installed* subset). Otherwise a
   * user dropping a VSIX for an uninstalled extension (the common
   * case: grabbing a CI-renamed artifact BEFORE installing) gets no
   * match at all. Sources, in priority order for longest-prefix
   * resolution (dedup via Set so overlap is free):
   *   1. `extensions.managed()` — currently installed Salesforce +
   *      user-allowlisted third-party ids.
   *   2. `store.list()` group members — every id mentioned by a
   *      built-in / user / pack / catalog group, even uninstalled.
   *   3. Publisher catalog snapshot — every Salesforce-published id
   *      the marketplace knows about, once the catalog has been
   *      refreshed at least once.
   */
  const vsixScannerIdLookup = (): string[] => {
    const ids = new Set<string>();
    for (const ext of extensions.managed()) ids.add(ext.id);
    for (const group of store.list()) for (const id of group.extensions) ids.add(id);
    for (const entry of publisherCatalog.current()) ids.add(entry.extensionId);
    return [...ids];
  };
  scanner.setManagedIdLookup(vsixScannerIdLookup);
  const busy = new BusyState();
  context.subscriptions.push({ dispose: () => busy.dispose() });
  const groupsTree = new GroupsTreeProvider(store, extensions, workspaceState, busy);
  groupsTree.setVsixSources(() => installer.currentSources());
  groupsTree.setVsixOverrides(() => installer.vsixOverrides());
  const dependenciesTree = new DependenciesTreeProvider(registry);

  const groupStatusBar = new GroupStatusBarItem(store, workspaceState, settings, busy);
  const vsixStatusBar = new VsixStatusBarItem(settings, installer, busy);
  context.subscriptions.push(groupStatusBar, vsixStatusBar);

  let vsixWatcher: vscode.Disposable | undefined = scanner.watch(() => {
    groupsTree.refresh();
    vsixStatusBar.update();
  });
  if (vsixWatcher) context.subscriptions.push(vsixWatcher);

  if (scanner.isConfigured() && !scanner.exists()) {
    const openSettings = getLocalization(LocalizationKeys.openSettingsAction);
    void vscode.window
      .showWarningMessage(
        getLocalization(LocalizationKeys.vsixDirectoryMissingWarn, scanner.getDirectory()),
        openSettings
      )
      .then(choice => {
        if (choice === openSettings) {
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
      if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.${SETTINGS.telemetryEnabled}`)) {
        TelemetryService.refreshEnabled();
      }
      if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.${SETTINGS.vsixDirectory}`)) {
        vsixWatcher?.dispose();
        scanner = new VsixScanner(settings.getVsixDirectory());
        scanner.setManagedIdLookup(vsixScannerIdLookup);
        installer = new VsixInstaller(scanner, codeCli, workspaceState, logger);
        extensions.setVsixInstaller(installer);
        extensions.setInstallSourceLookup(id => installer.currentSources()[id] ?? 'unknown');
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
    busy,
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
    groupsTree,
    busy
  });

  registerCatalogCommands(context, {
    catalog: publisherCatalog,
    extensions,
    logger,
    tree: groupsTree,
    busy
  });

  registerUpdateCommands(context, {
    codeCli,
    extensions,
    settings,
    logger,
    tree: groupsTree,
    busy
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.showLog, () => logger.show())
  );

  if (settings.getAutoRunDependencyChecks()) {
    void dependenciesTree.runChecks();
  }

  // Publisher catalog: fire one background refresh per activation unless
  // the user has explicitly opted out with `updateCheck: 'never'`. Without
  // this, the `All Salesforce Extensions` group never appears on a fresh
  // install and the feature is invisible to the user.
  //
  // `'manual'` still means "no periodic refresh" — we don't poll; we only
  // ever hit the marketplace once per session (and again on the explicit
  // Refresh / Check commands). That's a correct reading of the setting and
  // matches how VSCode's own extension-update check works.
  if (settings.getUpdateCheck() !== 'never') {
    void publisherCatalog.refresh().then(() => groupsTree.refresh());
  }

  // Populate installed-version descriptions immediately (no network), and
  // optionally probe the marketplace for update availability on startup.
  void groupsTree.refreshVersionInfo();
  if (settings.getUpdateCheck() === 'onStartup') {
    // refreshVersionInfo above already calls the marketplace probe when
    // `updateCheck !== 'never'`; rerun after a tick so the user sees the
    // badges without blocking activation.
    setTimeout(() => {
      void groupsTree.refreshVersionInfo();
    }, 0);
  }

  TelemetryService.sendActivation(hrStart);
  logger.info('Salesforce Extensions Manager activated.');
};

export const deactivate = (): void => {
  TelemetryService.sendDeactivation();
  TelemetryService.dispose();
};
