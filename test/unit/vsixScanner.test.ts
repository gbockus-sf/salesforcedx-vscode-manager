import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseVsixFilename,
  parseVsixFilenameFuzzy,
  VsixScanner
} from '../../src/vsix/vsixScanner';

describe('parseVsixFilename', () => {
  it('parses publisher.name-version.vsix', () => {
    expect(parseVsixFilename('salesforce.salesforcedx-vscode-apex-63.1.0.vsix')).toEqual({
      extensionId: 'salesforce.salesforcedx-vscode-apex',
      version: '63.1.0',
      filePath: 'salesforce.salesforcedx-vscode-apex-63.1.0.vsix',
      matchedBy: 'strict'
    });
  });

  it('accepts prerelease and metadata suffixes', () => {
    expect(parseVsixFilename('redhat.vscode-xml-0.26.0-beta.1.vsix')?.version).toBe('0.26.0-beta.1');
  });

  it('rejects non-vsix filenames', () => {
    expect(parseVsixFilename('readme.md')).toBeUndefined();
    expect(parseVsixFilename('no-publisher-1.0.0.vsix')).toBeUndefined();
  });
});

describe('parseVsixFilenameFuzzy', () => {
  const managed = [
    'salesforce.salesforcedx-einstein-gpt',
    'salesforce.salesforcedx-vscode-apex',
    'salesforce.salesforcedx-vscode-apex-replay-debugger',
    'salesforce.salesforcedx-vscode-core'
  ];

  it('matches a CI-renamed artifact to the managed extension via longest prefix', () => {
    // Real example from the TODO: internal build drops publisher and
    // appends a component suffix before the version.
    const result = parseVsixFilenameFuzzy(
      'salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix',
      managed
    );
    expect(result).toEqual({
      extensionId: 'salesforce.salesforcedx-einstein-gpt',
      version: '3.28.0',
      filePath: 'salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix',
      matchedBy: 'prefix'
    });
  });

  it('prefers the longest managed-id prefix over a shorter one', () => {
    // `salesforcedx-vscode-apex-replay-debugger-*` must win over
    // `salesforcedx-vscode-apex-*` so the Replay Debugger override
    // doesn't accidentally install over the base Apex row.
    const result = parseVsixFilenameFuzzy(
      'salesforcedx-vscode-apex-replay-debugger-63.1.0.vsix',
      managed
    );
    expect(result?.extensionId).toBe('salesforce.salesforcedx-vscode-apex-replay-debugger');
  });

  it('does not match across a non-boundary prefix character', () => {
    // `apex` must not match `apexoas-...` — the boundary guard
    // requires the char after the prefix to be `-`, `.`, or EOF.
    const result = parseVsixFilenameFuzzy('salesforcedx-vscode-apexoas-1.0.0.vsix', managed);
    expect(result).toBeUndefined();
  });

  it('returns undefined when nothing matches', () => {
    expect(
      parseVsixFilenameFuzzy('totally-unrelated-build-1.0.0.vsix', managed)
    ).toBeUndefined();
  });

  it('uses a sentinel version when no trailing version suffix is present', () => {
    // Rare: a VSIX without a version in the filename (e.g. the user
    // renamed it manually). Downstream install only cares about the
    // filepath, so we let it through with `0.0.0` so any version
    // compare stays well-ordered.
    const result = parseVsixFilenameFuzzy('salesforcedx-einstein-gpt.vsix', managed);
    expect(result?.extensionId).toBe('salesforce.salesforcedx-einstein-gpt');
    expect(result?.version).toBe('0.0.0');
  });

  it('ignores managed ids without a publisher prefix', () => {
    // Defensive: `managed()` always returns `publisher.name`, but if
    // a malformed id slipped in we shouldn't consider it.
    const result = parseVsixFilenameFuzzy('salesforcedx-einstein-gpt-1.0.0.vsix', [
      'salesforcedx-einstein-gpt' // no publisher dot
    ]);
    expect(result).toBeUndefined();
  });
});

describe('VsixScanner', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-scan-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('scan() returns empty when directory is unset or missing', () => {
    expect(new VsixScanner('').scan().size).toBe(0);
    expect(new VsixScanner('/nonexistent/path/xyz').scan().size).toBe(0);
  });

  it('scan() finds matching VSIX files keyed by extension id', () => {
    fs.writeFileSync(path.join(tmp, 'salesforce.foo-1.2.3.vsix'), '');
    fs.writeFileSync(path.join(tmp, 'redhat.vscode-xml-0.26.0.vsix'), '');
    fs.writeFileSync(path.join(tmp, 'not-a-vsix.txt'), '');
    const result = new VsixScanner(tmp).scan();
    expect(result.size).toBe(2);
    expect(result.get('salesforce.foo')?.version).toBe('1.2.3');
    expect(result.get('redhat.vscode-xml')?.filePath).toBe(path.join(tmp, 'redhat.vscode-xml-0.26.0.vsix'));
  });

  it('scan() fuzzy-matches ids sourced from groups/catalog, not just installed', () => {
    // Real-world case: user drops the Agentforce Vibes CI build
    // BEFORE installing vibes. The id must still be found because
    // every group-member / catalog id is part of the lookup.
    fs.writeFileSync(path.join(tmp, 'salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix'), '');
    const scanner = new VsixScanner(tmp);
    // Lookup mimics extension.ts's vsixScannerIdLookup: includes ids
    // referenced by groups/catalog even when vscode.extensions.all
    // wouldn't surface them.
    scanner.setManagedIdLookup(() => ['salesforce.salesforcedx-einstein-gpt']);
    const result = scanner.scan();
    expect(result.get('salesforce.salesforcedx-einstein-gpt')?.matchedBy).toBe('prefix');
  });

  it('scan() falls back to fuzzy matching when a managed-id lookup is wired', () => {
    // Mixed directory: strict artifact + CI-renamed artifact. Both
    // should resolve, each against its proper extension id, tagged
    // with the matching strategy.
    fs.writeFileSync(path.join(tmp, 'salesforce.salesforcedx-vscode-apex-63.1.0.vsix'), '');
    fs.writeFileSync(path.join(tmp, 'salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix'), '');
    const scanner = new VsixScanner(tmp);
    scanner.setManagedIdLookup(() => [
      'salesforce.salesforcedx-vscode-apex',
      'salesforce.salesforcedx-einstein-gpt'
    ]);
    const result = scanner.scan();
    expect(result.size).toBe(2);
    expect(result.get('salesforce.salesforcedx-vscode-apex')?.matchedBy).toBe('strict');
    const einstein = result.get('salesforce.salesforcedx-einstein-gpt');
    expect(einstein?.matchedBy).toBe('prefix');
    expect(einstein?.version).toBe('3.28.0');
  });

  it('scan() leaves unparseable filenames out without a managed-id lookup', () => {
    // Regression guard: fuzzy is opt-in. Nothing changes when the
    // hook isn't wired.
    fs.writeFileSync(path.join(tmp, 'salesforcedx-einstein-gpt-welcome-show-3.28.0.vsix'), '');
    const result = new VsixScanner(tmp).scan();
    expect(result.size).toBe(0);
  });

  it('isConfigured / exists reflect directory state', () => {
    expect(new VsixScanner('').isConfigured()).toBe(false);
    expect(new VsixScanner(tmp).isConfigured()).toBe(true);
    expect(new VsixScanner(tmp).exists()).toBe(true);
    expect(new VsixScanner('/nonexistent/xyz').exists()).toBe(false);
  });
});
