import type { Group } from './types';

export const BUILT_IN_GROUPS: readonly Group[] = [
  {
    id: 'apex',
    label: 'Apex',
    description: 'Apex development — server-side classes, triggers, SOQL, debugger.',
    extensions: [
      'salesforce.salesforcedx-vscode-core',
      'salesforce.salesforcedx-vscode-apex',
      'salesforce.salesforcedx-vscode-apex-debugger',
      'salesforce.salesforcedx-vscode-apex-replay-debugger',
      'salesforce.salesforcedx-vscode-apex-log',
      'salesforce.salesforcedx-vscode-apex-oas',
      'salesforce.salesforcedx-vscode-apex-testing',
      'salesforce.salesforcedx-vscode-soql',
      'salesforce.salesforcedx-vscode-visualforce',
      'redhat.vscode-xml'
    ],
    builtIn: true
  },
  {
    id: 'lightning',
    label: 'Lightning',
    description: 'Lightning / LWC development — Aura, LWC, design system, linting.',
    extensions: [
      'salesforce.salesforcedx-vscode-core',
      'salesforce.salesforcedx-vscode-services',
      'salesforce.salesforcedx-vscode-lightning',
      'salesforce.salesforcedx-vscode-lwc',
      'dbaeumer.vscode-eslint',
      'esbenp.prettier-vscode',
      'salesforce.lightning-design-system-vscode'
    ],
    builtIn: true
  },
  {
    id: 'react',
    label: 'React',
    description:
      'Salesforce React / LWR development — Agentforce Vibes, Live Preview, and the Metadata Visualizer.',
    extensions: [
      'salesforce.salesforcedx-einstein-gpt',
      'salesforce.salesforcedx-vscode-ui-preview',
      'salesforce.salesforcedx-metadata-visualizer-vscode'
    ],
    builtIn: true
  },
  {
    id: 'salesforce-extension-pack',
    label: 'Salesforce Extension Pack',
    description:
      'Every member of the `salesforce.salesforcedx-vscode` extension pack. Kept in sync with the pack manifest at packages/salesforcedx-vscode/package.json.',
    extensions: [
      'salesforce.salesforcedx-vscode-agents',
      'salesforce.salesforcedx-vscode-apex',
      'salesforce.salesforcedx-vscode-apex-testing',
      'salesforce.salesforcedx-vscode-apex-oas',
      'salesforce.salesforcedx-vscode-apex-log',
      'salesforce.salesforcedx-vscode-apex-replay-debugger',
      'salesforce.salesforcedx-einstein-gpt',
      'salesforce.salesforcedx-vscode-core',
      'salesforce.salesforcedx-vscode-lightning',
      'salesforce.salesforcedx-vscode-org',
      'salesforce.salesforcedx-vscode-org-browser',
      'salesforce.salesforcedx-vscode-visualforce',
      'salesforce.salesforcedx-vscode-lwc',
      'salesforce.salesforcedx-vscode-metadata',
      'salesforce.salesforcedx-vscode-services',
      'salesforce.salesforcedx-vscode-soql',
      'salesforce.salesforce-vscode-slds',
      'salesforce.sfdx-code-analyzer-vscode',
      'salesforce.apex-language-server-extension'
    ],
    builtIn: true,
    marketplaceExtensionId: 'salesforce.salesforcedx-vscode'
  },
  {
    id: 'salesforce-extension-pack-expanded',
    label: 'Salesforce Extension Pack (Expanded)',
    description:
      'Every member of the `salesforce.salesforcedx-vscode-expanded` extension pack, including the third-party additions (XML, Prettier, Lana). Kept in sync with packages/salesforcedx-vscode-expanded/package.json.',
    extensions: [
      'salesforce.salesforcedx-vscode-agents',
      'salesforce.salesforcedx-vscode-apex',
      'salesforce.salesforcedx-vscode-apex-log',
      'salesforce.salesforcedx-vscode-apex-testing',
      'salesforce.salesforcedx-vscode-apex-oas',
      'salesforce.salesforcedx-vscode-apex-replay-debugger',
      'salesforce.salesforcedx-einstein-gpt',
      'salesforce.salesforcedx-vscode-core',
      'salesforce.salesforcedx-vscode-lightning',
      'salesforce.salesforcedx-vscode-org',
      'salesforce.salesforcedx-vscode-org-browser',
      'salesforce.salesforcedx-vscode-visualforce',
      'salesforce.salesforcedx-vscode-lwc',
      'salesforce.salesforcedx-vscode-media',
      'salesforce.salesforcedx-vscode-metadata',
      'salesforce.salesforcedx-vscode-soql',
      'salesforce.salesforcedx-vscode-services',
      'salesforce.salesforce-vscode-slds',
      'salesforce.sfdx-code-analyzer-vscode',
      'salesforce.salesforcedx-vscode-ui-preview',
      'salesforce.apex-language-server-extension',
      'redhat.vscode-xml',
      'esbenp.prettier-vscode',
      'financialforce.lana'
    ],
    builtIn: true,
    marketplaceExtensionId: 'salesforce.salesforcedx-vscode-expanded'
  },
  {
    id: 'anypoint-extension-pack',
    label: 'Anypoint Extension Pack',
    description:
      'Every member of the `salesforce.mule-dx-extension-pack` (Anypoint Code Builder). Kept in sync with the pack manifest; suppressed automatically when the pack itself is installed and discovered via packGroups.',
    extensions: [
      'salesforce.mule-dx-api-component',
      'salesforce.mule-dx-apikit-component',
      'salesforce.mule-dx-data-weave-client',
      'salesforce.mule-dx-mule-dev-component',
      'salesforce.mule-dx-munit-component',
      'salesforce.mule-dx-dependencies',
      'salesforce.mule-dx-vscode',
      'salesforce.mule-dx-runtime'
    ],
    builtIn: true,
    marketplaceExtensionId: 'salesforce.mule-dx-extension-pack'
  }
];
