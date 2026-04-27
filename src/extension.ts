import * as vscode from 'vscode';
import { registerCatalogCommands } from './commands/catalogCommands';
import { registerDependencyCommands } from './commands/dependencyCommands';
import { registerGroupCommands } from './commands/groupCommands';
import { registerUpdateCommands } from './commands/updateCommands';
import { registerVsixCommands } from './commands/vsixCommands';
import {
  COMMANDS,
  CONFIG_NAMESPACE,
  CONTEXT_KEYS,
  SALESFORCE_PUBLISHER,
  SETTINGS,
  VIEW_DEPENDENCIES_ID,
  VIEW_GROUPS_ID,
  VIEW_VSIX_ID
} from './constants';
import { DependencyRegistry } from './dependencies/registry';
import { DependencyRunners } from './dependencies/runners';
import { GroupStore } from './groups/groupStore';
import { getLocalization, LocalizationKeys } from './localization';
import { CliVersionService } from './services/cliVersionService';
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
import { CliStatusBarItem } from './statusBar/cliStatusBarItem';
import { GroupStatusBarItem } from './statusBar/groupStatusBarItem';
import { VsixStatusBarItem } from './statusBar/vsixStatusBarItem';
import { VsixInstaller } from './vsix/vsixInstaller';
import { VsixScanner } from './vsix/vsixScanner';
import { DependenciesTreeProvider } from './views/dependenciesTreeProvider';
import { GroupsTreeProvider } from './views/groupsTreeProvider';
import { VsixTreeProvider } from './views/vsixTreeProvider';

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
  // Filter manifest / shim dep declarations by whether the extension is
  // still installed on disk. Without this, uninstalling Apex via a
  // Lightning-group apply leaves the Java check in the Dependencies
  // view — `vscode.extensions.all` is a startup snapshot and still
  // reports Apex as present. `ExtensionService.isInstalled` consults
  // disk so we get the authoritative answer mid-session.
  registry.setIsInstalledLookup(id => extensions.isInstalled(id));

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
  const vsixTree = new VsixTreeProvider(scanner, extensions);
  const dependenciesTree = new DependenciesTreeProvider(registry);

  /**
   * Ask the installed Salesforce CLI whether it has an update
   * pending (`sf version` prints a warning line when its self-
   * update detector has one). No network call from our side —
   * the CLI already tells us based on whichever channel it's
   * configured to watch. Runs in the background; the tree
   * renders without a badge until the probe resolves.
   */
  const cliVersion = new CliVersionService({ logger, process: proc });
  const refreshCliLatestVersion = (): void => {
    void cliVersion.getLatestVersion().then(version => {
      dependenciesTree.setCliLatestVersion(version);
    });
  };
  refreshCliLatestVersion();

  const groupStatusBar = new GroupStatusBarItem(store, workspaceState, settings, busy);
  const vsixStatusBar = new VsixStatusBarItem(settings, installer, busy);
  const cliStatusBar = new CliStatusBarItem(settings, dependenciesTree);
  context.subscriptions.push(groupStatusBar, vsixStatusBar, cliStatusBar);

  /**
   * Keep the `sfdxManager.hasVsixOverrides` context key in sync with
   * the scanner's current snapshot. The key drives the `when` clause
   * on the VSIX tree view (`package.json`) so the view appears as
   * soon as the first override shows up and hides itself when the
   * last one goes away — users with no overrides never see it.
   */
  const updateHasOverridesContext = (): void => {
    const has = scanner.scan().size > 0;
    void vscode.commands.executeCommand('setContext', CONTEXT_KEYS.hasVsixOverrides, has);
  };
  updateHasOverridesContext();

  /**
   * Auto-install every VSIX in the override directory. Runs at
   * activation and on any file-system change under the directory.
   * Idempotent: already-installed rows at the matching version are
   * skipped. Wrapped in `busy.withBusy` so the Groups panel freezes
   * for the duration — users can't double-click a row while the
   * override install is landing. Silent on success; logs every
   * decision to the output channel.
   */
  const runAutoInstall = async (): Promise<void> => {
    if (!settings.getVsixAutoInstall()) return;
    if (!scanner.isConfigured()) return;
    const overrideIds = [...scanner.scan().keys()];
    if (overrideIds.length === 0) return;
    const result = await busy.withBusy(overrideIds, () => installer.autoInstallAll());
    groupsTree.refresh();
    vsixTree.refresh();
    vsixStatusBar.update();
    if (result.failed.length > 0) {
      void vscode.window.showWarningMessage(
        getLocalization(LocalizationKeys.vsixAutoInstallFailed, result.failed.length)
      );
    }
    logger.info(
      `vsixAutoInstall: installed=${result.installed.length} skipped=${result.skipped.length} failed=${result.failed.length}`
    );
  };

  let vsixWatcher: vscode.Disposable | undefined = scanner.watch(() => {
    updateHasOverridesContext();
    groupsTree.refresh();
    vsixTree.refresh();
    vsixStatusBar.update();
    void runAutoInstall();
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
    vscode.window.registerTreeDataProvider(VIEW_VSIX_ID, vsixTree),
    vscode.window.registerTreeDataProvider(VIEW_DEPENDENCIES_ID, dependenciesTree),
    settings.onDidChange(e => {
      if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.${SETTINGS.vsixDirectory}`)) {
        vsixWatcher?.dispose();
        scanner = new VsixScanner(settings.getVsixDirectory());
        scanner.setManagedIdLookup(vsixScannerIdLookup);
        installer = new VsixInstaller(scanner, codeCli, workspaceState, logger);
        extensions.setVsixInstaller(installer);
        extensions.setInstallSourceLookup(id => installer.currentSources()[id] ?? 'unknown');
        groupsTree.setVsixSources(() => installer.currentSources());
        groupsTree.setVsixOverrides(() => installer.vsixOverrides());
        vsixTree.setScanner(scanner);
        vsixStatusBar.setInstaller(installer);
        updateHasOverridesContext();
        vsixWatcher = scanner.watch(() => {
          updateHasOverridesContext();
          groupsTree.refresh();
          vsixTree.refresh();
          vsixStatusBar.update();
          void runAutoInstall();
        });
        if (vsixWatcher) context.subscriptions.push(vsixWatcher);
        void runAutoInstall();
      }
      groupsTree.refresh();
      vsixTree.refresh();
      dependenciesTree.refresh();
      groupStatusBar.update();
      vsixStatusBar.update();
      cliStatusBar.update();
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
    logger,
    cliVersion
  });

  registerVsixCommands(context, {
    scanner,
    installer,
    extensions,
    settings,
    workspaceState,
    logger,
    groupsTree,
    vsixTree,
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
  } else {
    // Even with the broader auto-run opt-in disabled, probe the
    // Salesforce CLI check in the background so the update
    // indicator (status-bar + tree badge) has the installed
    // version it needs. `sf --version` is a local shell call —
    // cheap enough to always run, and without it the indicator
    // only fires once the user manually kicks the dep check,
    // which most users won't do until something breaks.
    void dependenciesTree.runOne('builtin.sf-cli');
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

  // VSIX overrides are authoritative — if the user has files in the
  // directory, make sure they're installed now. Kicked off in the
  // background so activation stays snappy; the BusyState freezes the
  // Groups panel for the duration so clicks can't race the install.
  void runAutoInstall();

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
