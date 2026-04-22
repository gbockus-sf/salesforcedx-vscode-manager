export type CheckDefinition =
  | { type: 'exec'; command: string; args?: string[]; versionRegex?: string; minVersion?: string }
  | { type: 'env'; env: string; fallback?: CheckDefinition }
  | { type: 'file'; path: string }
  | { type: 'nodeVersion'; minVersion: string }
  | { type: 'extensionInstalled'; extensionId: string };

export interface DependencyCheck {
  id: string;
  label: string;
  category: 'cli' | 'runtime' | 'per-extension';
  /**
   * Convenience pointer to the first entry in `ownerExtensionIds` (if any).
   * Kept for backward compat with consumers that read a single owner; use
   * `ownerExtensionIds` to render the full list when a logical check has
   * multiple contributing extensions.
   */
  ownerExtensionId?: string;
  /**
   * Every extension that contributed a declaration matching this check's
   * logical fingerprint (see `DependencyRegistry.collect`). Empty / omitted
   * for built-in manager checks with no owning extension.
   */
  ownerExtensionIds?: string[];
  check: CheckDefinition;
  remediation?: string;
  remediationUrl?: string;
}

export interface DependencyStatus {
  state: 'ok' | 'warn' | 'fail' | 'unknown';
  detail?: string;
  version?: string;
}
