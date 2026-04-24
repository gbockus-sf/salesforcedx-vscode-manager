import { describe, expect, it, jest } from '@jest/globals';
import { VsixTreeProvider } from '../../src/views/vsixTreeProvider';
import type { ExtensionService } from '../../src/services/extensionService';
import type { VsixOverride } from '../../src/vsix/types';
import type { VsixScanner } from '../../src/vsix/vsixScanner';

const mkScanner = (entries: VsixOverride[]): VsixScanner => {
  const map = new Map<string, VsixOverride>();
  for (const e of entries) map.set(e.extensionId, e);
  return { scan: jest.fn(() => map) } as unknown as VsixScanner;
};

const mkExt = (labels?: Record<string, string>): ExtensionService =>
  ({ label: jest.fn((id: string) => labels?.[id] ?? id) } as unknown as ExtensionService);

describe('VsixTreeProvider', () => {
  it('root children are one row per override, sorted by extension id', () => {
    const provider = new VsixTreeProvider(
      mkScanner([
        {
          extensionId: 'salesforce.zed',
          version: '1.0.0',
          filePath: '/tmp/salesforce.zed-1.0.0.vsix',
          matchedBy: 'strict'
        },
        {
          extensionId: 'salesforce.alpha',
          version: '2.0.0',
          filePath: '/tmp/salesforce.alpha-2.0.0.vsix',
          matchedBy: 'strict'
        }
      ]),
      mkExt()
    );
    const children = provider.getChildren();
    expect(children.map(c => c.extensionId)).toEqual(['salesforce.alpha', 'salesforce.zed']);
  });

  it('renders each row with display name, version+filename description, and the contextValue menu anchor', () => {
    const provider = new VsixTreeProvider(
      mkScanner([
        {
          extensionId: 'salesforce.salesforcedx-einstein-gpt',
          version: '3.28.0',
          filePath: '/tmp/salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix',
          matchedBy: 'prefix'
        }
      ]),
      mkExt({ 'salesforce.salesforcedx-einstein-gpt': 'Agentforce Vibes' })
    );
    const [node] = provider.getChildren();
    const item = provider.getTreeItem(node);
    expect(item.label).toBe('Agentforce Vibes');
    expect(String(item.description)).toContain('3.28.0');
    expect(String(item.description)).toContain('salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix');
    expect(item.contextValue).toBe('vsix:override');
  });

  it('setScanner swaps the backing scanner and refreshes', () => {
    // Used by extension.ts when the vsixDirectory setting changes.
    const scannerA = mkScanner([
      { extensionId: 'salesforce.a', version: '1.0.0', filePath: '/a/s.a-1.0.0.vsix' }
    ]);
    const scannerB = mkScanner([
      { extensionId: 'salesforce.b', version: '2.0.0', filePath: '/b/s.b-2.0.0.vsix' }
    ]);
    const provider = new VsixTreeProvider(scannerA, mkExt());
    expect(provider.getChildren().map(c => c.extensionId)).toEqual(['salesforce.a']);
    provider.setScanner(scannerB);
    expect(provider.getChildren().map(c => c.extensionId)).toEqual(['salesforce.b']);
  });
});
