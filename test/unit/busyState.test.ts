import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import * as vscode from 'vscode';
import { BusyState } from '../../src/util/busyState';

describe('BusyState', () => {
  beforeEach(() => {
    (vscode.commands.executeCommand as jest.Mock).mockClear();
  });

  it('marks ids busy for the duration of withBusy and releases afterward', async () => {
    const busy = new BusyState();
    let observedDuringRun = false;
    await busy.withBusy(['salesforce.foo'], async () => {
      observedDuringRun = busy.isBusy('salesforce.foo');
    });
    expect(observedDuringRun).toBe(true);
    expect(busy.isBusy('salesforce.foo')).toBe(false);
    expect(busy.hasAny()).toBe(false);
  });

  it('releases ids even when the wrapped function throws', async () => {
    const busy = new BusyState();
    await expect(
      busy.withBusy(['salesforce.foo'], async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(busy.isBusy('salesforce.foo')).toBe(false);
    expect(busy.hasAny()).toBe(false);
  });

  it('refcounts overlapping calls — the id stays busy until the last caller releases', async () => {
    const busy = new BusyState();
    let releaseOuter!: () => void;
    let releaseInner!: () => void;
    const outer = busy.withBusy(
      ['salesforce.foo'],
      () => new Promise<void>(resolve => { releaseOuter = resolve; })
    );
    const inner = busy.withBusy(
      ['salesforce.foo'],
      () => new Promise<void>(resolve => { releaseInner = resolve; })
    );
    // Both calls are in flight — id busy.
    expect(busy.isBusy('salesforce.foo')).toBe(true);
    releaseInner();
    await inner;
    // Outer still holds the id.
    expect(busy.isBusy('salesforce.foo')).toBe(true);
    releaseOuter();
    await outer;
    expect(busy.isBusy('salesforce.foo')).toBe(false);
  });

  it('fires onChange on every transition', async () => {
    const busy = new BusyState();
    const events: boolean[] = [];
    busy.onChange(() => events.push(busy.hasAny()));
    await busy.withBusy(['a'], async () => undefined);
    // Expect two fires: acquire (hasAny=true) and release (hasAny=false).
    expect(events).toEqual([true, false]);
  });

  it('sets the context key true on first acquire and false on final release', async () => {
    const busy = new BusyState();
    // Constructor seeds one "false" call.
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'sfdxManager.anyBusy',
      false
    );
    await busy.withBusy(['a'], async () => {
      // During the run we should have flipped to true.
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'setContext',
        'sfdxManager.anyBusy',
        true
      );
    });
    expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
      'setContext',
      'sfdxManager.anyBusy',
      false
    );
  });

  it('does not re-set the context key on overlapping acquires', async () => {
    const busy = new BusyState();
    (vscode.commands.executeCommand as jest.Mock).mockClear();
    let releaseOuter!: () => void;
    let releaseInner!: () => void;
    const outer = busy.withBusy(['a'], () => new Promise<void>(resolve => { releaseOuter = resolve; }));
    const inner = busy.withBusy(['b'], () => new Promise<void>(resolve => { releaseInner = resolve; }));
    // Only the first acquire should have flipped the context key to true;
    // the second acquire leaves it alone.
    const trueCalls = (vscode.commands.executeCommand as jest.Mock).mock.calls.filter(
      c => c[0] === 'setContext' && c[1] === 'sfdxManager.anyBusy' && c[2] === true
    );
    expect(trueCalls.length).toBe(1);
    releaseInner();
    await inner;
    // Still busy — context key stays true, no false-call yet.
    const falseCallsAfterInner = (vscode.commands.executeCommand as jest.Mock).mock.calls.filter(
      c => c[0] === 'setContext' && c[1] === 'sfdxManager.anyBusy' && c[2] === false
    );
    expect(falseCallsAfterInner.length).toBe(0);
    releaseOuter();
    await outer;
    const falseCallsAfterOuter = (vscode.commands.executeCommand as jest.Mock).mock.calls.filter(
      c => c[0] === 'setContext' && c[1] === 'sfdxManager.anyBusy' && c[2] === false
    );
    expect(falseCallsAfterOuter.length).toBe(1);
  });

  it('deduplicates repeated ids within a single withBusy call', async () => {
    const busy = new BusyState();
    await busy.withBusy(['a', 'a', 'b'], async () => {
      expect(busy.isBusy('a')).toBe(true);
      expect(busy.isBusy('b')).toBe(true);
    });
    expect(busy.isBusy('a')).toBe(false);
    expect(busy.isBusy('b')).toBe(false);
  });
});
