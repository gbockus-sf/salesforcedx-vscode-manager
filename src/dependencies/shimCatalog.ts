import type { DependencyCheck } from './types';

/**
 * Fallback per-extension dependency checks, keyed by extension id. Used for
 * extensions that haven't (yet) adopted the `salesforceDependencies` manifest
 * contract. Seeded with the minimum set we have actual, verifiable knowledge
 * of; do NOT add entries here speculatively.
 *
 * Java check is a direct port in spirit of
 * `salesforcedx-vscode-apex/src/requirements.ts` (JAVA_HOME env var with a
 * `java -version` exec fallback, min version 11.0.0).
 */
export const shimCatalog: Record<string, DependencyCheck[]> = {
  'salesforce.salesforcedx-vscode-apex': [
    {
      id: 'apex.java',
      label: 'Java JDK 11+',
      category: 'runtime',
      ownerExtensionId: 'salesforce.salesforcedx-vscode-apex',
      check: {
        type: 'env',
        env: 'JAVA_HOME',
        fallback: {
          type: 'exec',
          command: 'java',
          args: ['-version'],
          minVersion: '11.0.0'
        }
      },
      remediation: 'Install Temurin 17+ and set JAVA_HOME.',
      remediationUrl: 'https://adoptium.net/'
    }
  ],
  'salesforce.salesforcedx-vscode-core': [
    {
      id: 'core.sf-cli',
      label: 'Salesforce CLI (sf)',
      category: 'cli',
      ownerExtensionId: 'salesforce.salesforcedx-vscode-core',
      check: {
        type: 'exec',
        command: 'sf',
        args: ['--version'],
        minVersion: '2.0.0'
      },
      remediation: 'Install the Salesforce CLI (sf) v2 or newer.',
      remediationUrl: 'https://developer.salesforce.com/tools/salesforcecli'
    }
  ],
  'salesforce.salesforcedx-vscode-lwc': [
    {
      id: 'lwc.node',
      label: 'Node.js 18+',
      category: 'runtime',
      ownerExtensionId: 'salesforce.salesforcedx-vscode-lwc',
      check: {
        type: 'nodeVersion',
        minVersion: '18.0.0'
      },
      remediation: 'Install Node.js 18 or newer.',
      remediationUrl: 'https://nodejs.org/'
    }
  ]
};

/** Extension ids that have a shim entry. */
export const shimmedExtensionIds = (): string[] => Object.keys(shimCatalog);
