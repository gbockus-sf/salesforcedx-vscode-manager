import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseVsixFilename, VsixScanner } from '../../src/vsix/vsixScanner';

describe('parseVsixFilename', () => {
  it('parses publisher.name-version.vsix', () => {
    expect(parseVsixFilename('salesforce.salesforcedx-vscode-apex-63.1.0.vsix')).toEqual({
      extensionId: 'salesforce.salesforcedx-vscode-apex',
      version: '63.1.0',
      filePath: 'salesforce.salesforcedx-vscode-apex-63.1.0.vsix'
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

  it('isConfigured / exists reflect directory state', () => {
    expect(new VsixScanner('').isConfigured()).toBe(false);
    expect(new VsixScanner(tmp).isConfigured()).toBe(true);
    expect(new VsixScanner(tmp).exists()).toBe(true);
    expect(new VsixScanner('/nonexistent/xyz').exists()).toBe(false);
  });
});
