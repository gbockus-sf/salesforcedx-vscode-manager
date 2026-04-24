import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../..');

const readJson = <T>(relPath: string): T =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8')) as T;

interface ViewsWelcome { view: string; contents: string }
interface MenuEntry { command: string; when: string; group?: string }
interface Manifest {
  contributes: {
    viewsWelcome?: ViewsWelcome[];
    views: Record<string, Array<{ id: string; when?: string }>>;
    menus: {
      'view/item/context': MenuEntry[];
      'view/title': MenuEntry[];
    };
  };
}

describe('viewsWelcome contributions', () => {
  const pkg = readJson<Manifest>('package.json');
  const nls = readJson<Record<string, string>>('package.nls.json');

  it('has a viewsWelcome entry for every registered view in the sfdxManager container', () => {
    // VSCode falls back to its "There is no data provider registered…"
    // message before our tree provider registers, which briefly shows
    // on cold start. viewsWelcome is how we swap that for friendly
    // copy; every view we contribute must have one.
    const viewIds = (pkg.contributes.views.sfdxManager ?? []).map(v => v.id);
    expect(viewIds).toEqual(
      expect.arrayContaining(['sfdxManager.groups', 'sfdxManager.dependencies'])
    );
    const welcomeViews = (pkg.contributes.viewsWelcome ?? []).map(w => w.view);
    for (const viewId of viewIds) {
      expect(welcomeViews).toContain(viewId);
    }
  });

  it('each viewsWelcome contents field uses an nls placeholder that resolves to a non-empty value', () => {
    for (const entry of pkg.contributes.viewsWelcome ?? []) {
      // VSCode resolves `%key%` placeholders in viewsWelcome.contents
      // from package.nls.json at extension load.
      const match = /^%([^%]+)%$/.exec(entry.contents);
      expect(match).not.toBeNull();
      const key = match![1];
      expect(nls[key]).toBeDefined();
      expect(nls[key].length).toBeGreaterThan(0);
    }
  });

  it('the VSIX view is gated on the sfdxManager.hasVsixOverrides context key', () => {
    // Hides the view entirely when the override directory is empty,
    // surfaces it as soon as the user drops the first .vsix. The
    // context key is updated in extension.ts on every scanner change.
    const vsixView = (pkg.contributes.views.sfdxManager ?? []).find(v => v.id === 'sfdxManager.vsix');
    expect(vsixView).toBeDefined();
    expect(vsixView!.when).toBe('sfdxManager.hasVsixOverrides');
  });

  it('install / uninstall / update menu entries on the Groups view guard against :vsixLocked rows', () => {
    // VSIX overrides are authoritative — a row with an override
    // shouldn't offer install/uninstall/update actions. The guard
    // clause is `!(viewItem =~ /:vsixLocked/)` appended to every
    // relevant when clause. If this test fails, a future edit
    // dropped the guard and user actions can clash with the
    // override directory.
    const gatedCommands = new Set([
      'sfdxManager.installExtension',
      'sfdxManager.uninstallExtension',
      'sfdxManager.updateExtension'
    ]);
    const contextEntries = pkg.contributes.menus['view/item/context'].filter(
      e =>
        gatedCommands.has(e.command) &&
        e.when.includes('view == sfdxManager.groups') &&
        // Only the entries that target real extension rows need the
        // guard; the `extension:child:*` nav entries don't mutate.
        !e.when.includes('extension:child:')
    );
    expect(contextEntries.length).toBeGreaterThan(0);
    for (const entry of contextEntries) {
      expect(entry.when).toContain(':vsixLocked');
    }
  });

  it('welcome copy is plain descriptive text with no command-link buttons', () => {
    // The welcome is intentionally button-free — VSCode renders
    // `[label](command:<id>)` markdown as buttons, and on cold start
    // those buttons looked like the only things a user could do,
    // which crowded the real tree rows once they loaded. Keep the
    // welcome purely informational. If a future change reintroduces
    // command: links, also verify they reference a declared command
    // (grep the registered-command list as the old test did).
    for (const entry of pkg.contributes.viewsWelcome ?? []) {
      const key = /^%([^%]+)%$/.exec(entry.contents)?.[1];
      expect(key).toBeDefined();
      const copy = nls[key!];
      expect(copy).not.toMatch(/command:/);
    }
  });
});
