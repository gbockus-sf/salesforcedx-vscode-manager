import * as extension from '../../src/extension';

describe('extension entry point', () => {
  it('exports activate and deactivate', () => {
    expect(typeof extension.activate).toBe('function');
    expect(typeof extension.deactivate).toBe('function');
  });

  it('activate runs without error with a minimal context', () => {
    const fakeContext = { subscriptions: [] } as unknown as Parameters<typeof extension.activate>[0];
    expect(() => extension.activate(fakeContext)).not.toThrow();
  });
});
