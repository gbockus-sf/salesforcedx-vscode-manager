import { compare } from '../../src/dependencies/versionCompare';

describe('versionCompare.compare', () => {
  it('orders basic semver correctly', () => {
    expect(compare('1.2.3', '1.2.4')).toBe(-1);
    expect(compare('1.2.4', '1.2.3')).toBe(1);
    expect(compare('1.2.3', '1.2.3')).toBe(0);
  });

  it('orders across minor and major', () => {
    expect(compare('1.9.9', '2.0.0')).toBe(-1);
    expect(compare('2.0.0', '1.9.9')).toBe(1);
    expect(compare('1.0.0', '1.1.0')).toBe(-1);
  });

  it('strips a leading v prefix', () => {
    expect(compare('v1.2.3', '1.2.3')).toBe(0);
    expect(compare('V2.0.0', 'v1.9.9')).toBe(1);
  });

  it('ignores build metadata suffixes', () => {
    expect(compare('11.0.0+35', '11.0.0')).toBe(0);
    expect(compare('11.0.1+1', '11.0.0+99')).toBe(1);
  });

  it('ignores pre-release suffixes (v0.1 scope)', () => {
    expect(compare('1.2.3-rc.1', '1.2.3')).toBe(0);
    expect(compare('2.0.0-alpha', '1.9.9')).toBe(1);
  });

  it('zero-fills a missing patch or minor', () => {
    expect(compare('1', '1.0.0')).toBe(0);
    expect(compare('1.2', '1.2.0')).toBe(0);
    expect(compare('1.2', '1.2.1')).toBe(-1);
  });

  it('handles salesforce sf CLI-style versions', () => {
    expect(compare('2.15.4', '2.0.0')).toBe(1);
    expect(compare('2.0.0', '2.15.4')).toBe(-1);
  });

  it('handles non-numeric garbage gracefully', () => {
    expect(compare('not-a-version', '0.0.0')).toBe(0);
    expect(compare('1.x.3', '1.0.3')).toBe(0);
  });
});
