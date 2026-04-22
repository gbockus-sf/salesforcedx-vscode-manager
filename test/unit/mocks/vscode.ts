export const window = {
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    dispose: jest.fn()
  })),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  createStatusBarItem: jest.fn(() => ({
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
    text: '',
    tooltip: '',
    command: ''
  }))
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn()
};

export const workspace = {
  getConfiguration: jest.fn(() => ({
    get: jest.fn(),
    update: jest.fn()
  })),
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  createFileSystemWatcher: jest.fn(() => ({
    onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
    onDidDelete: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    dispose: jest.fn()
  }))
};

export const extensions = {
  all: [] as unknown[],
  getExtension: jest.fn()
};

export const env = {
  appRoot: '/fake/app/root',
  openExternal: jest.fn()
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

export class TreeItem {
  constructor(public label: string, public collapsibleState?: TreeItemCollapsibleState) {}
}

export class ThemeIcon {
  constructor(public id: string) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}
