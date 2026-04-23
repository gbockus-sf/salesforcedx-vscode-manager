import * as vscode from 'vscode';
import { discoverPackGroups, packGroupId } from '../../src/groups/packGroups';

const makeExt = (
  id: string,
  pkg: Record<string, unknown> = {}
): vscode.Extension<unknown> => ({ id, packageJSON: pkg }) as unknown as vscode.Extension<unknown>;

describe('discoverPackGroups', () => {
  beforeEach(() => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [];
  });

  it('returns empty when no Salesforce-published pack is installed', () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
      makeExt('redhat.vscode-xml', { extensionPack: ['some.thing'] }),
      makeExt('salesforce.salesforcedx-vscode-apex', { })
    ];
    expect(discoverPackGroups()).toEqual([]);
  });

  it('picks up any Salesforce-published extension with a non-empty extensionPack', () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
      makeExt('salesforce.salesforcedx-vscode', {
        displayName: 'Salesforce Extension Pack',
        description: 'The core pack.',
        extensionPack: [
          'salesforce.salesforcedx-vscode-apex',
          'salesforce.salesforcedx-vscode-core'
        ]
      }),
      makeExt('salesforce.salesforcedx-vscode-expanded', {
        displayName: 'Salesforce Extension Pack (Expanded)',
        extensionPack: ['salesforce.salesforcedx-vscode-lwc', 'redhat.vscode-xml']
      })
    ];
    const groups = discoverPackGroups();
    expect(groups.map(g => g.id)).toEqual([
      packGroupId('salesforce.salesforcedx-vscode'),
      packGroupId('salesforce.salesforcedx-vscode-expanded')
    ]);
    expect(groups[0].label).toBe('Salesforce Extension Pack');
    expect(groups[0].description).toBe('The core pack.');
    expect(groups[0].source).toBe('pack');
    expect(groups[0].builtIn).toBe(true);
    expect(groups[0].extensions).toEqual([
      'salesforce.salesforcedx-vscode-apex',
      'salesforce.salesforcedx-vscode-core'
    ]);
  });

  it('ignores non-Salesforce publishers even if they declare an extensionPack', () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
      makeExt('microsoft.something', {
        displayName: 'Something',
        extensionPack: ['a.b', 'c.d']
      })
    ];
    expect(discoverPackGroups()).toEqual([]);
  });

  it('falls back to the extension id when displayName is missing', () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
      makeExt('salesforce.nameless-pack', { extensionPack: ['x.y'] })
    ];
    expect(discoverPackGroups()[0].label).toBe('salesforce.nameless-pack');
  });

  it('ignores empty or malformed extensionPack arrays', () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
      makeExt('salesforce.empty-pack', { extensionPack: [] }),
      makeExt('salesforce.not-array', { extensionPack: 'nope' }),
      makeExt('salesforce.mixed', {
        displayName: 'Mixed',
        extensionPack: ['keep.this', 42, 'and.this']
      })
    ];
    const groups = discoverPackGroups();
    expect(groups.map(g => g.id)).toEqual([packGroupId('salesforce.mixed')]);
    expect(groups[0].extensions).toEqual(['keep.this', 'and.this']);
  });

  it('sorts results by extension id so iteration order is stable', () => {
    (vscode.extensions as unknown as { all: vscode.Extension<unknown>[] }).all = [
      makeExt('salesforce.zebra-pack', { extensionPack: ['x.y'] }),
      makeExt('salesforce.alpha-pack', { extensionPack: ['x.y'] })
    ];
    expect(discoverPackGroups().map(g => g.id)).toEqual([
      packGroupId('salesforce.alpha-pack'),
      packGroupId('salesforce.zebra-pack')
    ]);
  });
});
