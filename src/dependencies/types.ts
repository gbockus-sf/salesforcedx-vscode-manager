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
  ownerExtensionId?: string;
  check: CheckDefinition;
  remediation?: string;
  remediationUrl?: string;
}

export interface DependencyStatus {
  state: 'ok' | 'warn' | 'fail' | 'unknown';
  detail?: string;
  version?: string;
}
