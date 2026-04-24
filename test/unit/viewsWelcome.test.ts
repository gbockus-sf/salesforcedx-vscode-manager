import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../..');

const readJson = <T>(relPath: string): T =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8')) as T;

interface ViewsWelcome { view: string; contents: string }
interface Manifest {
  contributes: {
    viewsWelcome?: ViewsWelcome[];
    views: Record<string, Array<{ id: string }>>;
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

  it('welcome copy points at commands the extension actually registers', () => {
    // Prevents stale command links that would render as broken buttons
    // (VSCode silently no-ops `command:<unknown>` clicks).
    const declaredCommands = new Set(
      (pkg as unknown as { contributes: { commands: Array<{ command: string }> } })
        .contributes.commands.map(c => c.command)
    );
    for (const entry of pkg.contributes.viewsWelcome ?? []) {
      const key = /^%([^%]+)%$/.exec(entry.contents)?.[1];
      expect(key).toBeDefined();
      const copy = nls[key!];
      const commandMatches = Array.from(copy.matchAll(/command:([A-Za-z0-9._-]+)/g));
      expect(commandMatches.length).toBeGreaterThan(0);
      for (const [, cmd] of commandMatches) {
        expect(declaredCommands.has(cmd)).toBe(true);
      }
    }
  });
});
