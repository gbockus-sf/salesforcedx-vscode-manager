export const window = {
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    dispose: jest.fn()
  })),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showQuickPick: jest.fn(),
  createStatusBarItem: jest.fn(() => ({
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
    text: '',
    tooltip: '',
    command: ''
  })),
  registerTreeDataProvider: jest.fn(() => ({ dispose: jest.fn() })),
  withProgress: jest.fn(
    async (
      _options: unknown,
      task: (progress: { report: (value: unknown) => void }) => unknown
    ) => task({ report: () => undefined })
  ),
  createTerminal: jest.fn(() => ({
    show: jest.fn(),
    sendText: jest.fn(),
    dispose: jest.fn()
  })),
  onDidCloseTerminal: jest.fn(() => ({ dispose: jest.fn() }))
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn(),
  getCommands: jest.fn(async () => [
    'workbench.extensions.action.enableExtension',
    'workbench.extensions.action.disableExtension',
    'workbench.extensions.search',
    'workbench.action.openSettings'
  ])
};

export const workspace = {
  getConfiguration: jest.fn(() => ({
    get: jest.fn((_key: string, def?: unknown) => def),
    update: jest.fn()
  })),
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  createFileSystemWatcher: jest.fn(() => ({
    onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
    onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    dispose: jest.fn()
  })),
  workspaceFolders: undefined as { uri: { fsPath: string } }[] | undefined
};

export enum ConfigurationTarget { Global = 1, Workspace = 2, WorkspaceFolder = 3 }

export const extensions = {
  all: [] as unknown[],
  getExtension: jest.fn()
};

export const env = {
  appRoot: '/fake/app/root',
  openExternal: jest.fn(),
  clipboard: { writeText: jest.fn() },
  // Undefined simulates running locally; tests that need Remote-SSH /
  // WSL / Codespaces semantics set this to a truthy string.
  remoteName: undefined as string | undefined
};

/**
 * Minimal `vscode.l10n` shim: returns the source string with `{n}` placeholders
 * substituted from the positional args. No translation lookup in tests.
 */
export const l10n = {
  t: jest.fn((message: string, ...args: (string | number | boolean)[]): string =>
    message.replace(/\{(\d+)\}/g, (_match, digits: string) => {
      const index = Number(digits);
      return index < args.length ? String(args[index]) : `{${digits}}`;
    })
  )
};

export const Uri = {
  file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }),
  parse: (s: string) => ({ fsPath: s, toString: () => s })
};

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T): void { this.listeners.forEach(l => l(data)); }
  dispose(): void { this.listeners = []; }
}

export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
export enum StatusBarAlignment { Left = 1, Right = 2 }
export enum ProgressLocation { SourceControl = 1, Window = 10, Notification = 15 }

export class TreeItem {
  constructor(public label: string, public collapsibleState?: TreeItemCollapsibleState) {}
}

export class ThemeIcon {
  constructor(public id: string) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}
