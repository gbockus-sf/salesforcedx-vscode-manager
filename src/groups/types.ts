export type ApplyScope = 'disableOthers' | 'enableOnly' | 'ask';

export interface Group {
  id: string;
  label: string;
  description?: string;
  extensions: string[];
  applyScope?: ApplyScope;
  builtIn?: boolean;
}
