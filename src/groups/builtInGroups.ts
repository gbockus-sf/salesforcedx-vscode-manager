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
    description: 'React / JS tooling. Empty by default — edit this group with the members you want.',
    extensions: [],
    builtIn: true
  }
];
