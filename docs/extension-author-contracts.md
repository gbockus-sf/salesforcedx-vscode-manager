# Manager contracts for Salesforce extension authors

If you maintain a Salesforce-published VSCode extension, the Extensions
Manager can surface richer information about your extension's
prerequisites and compatibility requirements — provided you opt in by
adding a couple of custom fields to your extension's `package.json`.

The manager reads these fields **statically** — it never activates
your extension, and disabled extensions still contribute. No runtime
coupling, no dependency on the manager at install time. Extensions
that don't adopt these contracts continue to work; the manager falls
back to a built-in shim catalog for common cases.

## `salesforceDependencies` (active)

Declares external prerequisites your extension needs — CLIs, runtimes,
env vars, sibling extensions. The manager's **Dependencies** tree
shows each row's status live, with one-click remediation links.

### Schema

```jsonc
{
  "name": "salesforcedx-vscode-apex",
  "salesforceDependencies": [
    {
      "id": "java-jdk",
      "label": "Java JDK 11+",
      "category": "runtime",
      "check": {
        "type": "env",
        "env": "JAVA_HOME",
        "fallback": {
          "type": "exec",
          "command": "java",
          "args": ["-version"],
          "minVersion": "11.0.0"
        }
      },
      "remediation": "Install Temurin 17+ and set JAVA_HOME",
      "remediationUrl": "https://adoptium.net/"
    }
  ]
}
```

### Fields

| Field | Required | Description |
|---|---|---|
| `id` | yes | Stable identifier for this dependency. Used for dedup. |
| `label` | yes | Human-readable name shown in the tree. |
| `category` | yes | `cli` / `runtime` / `per-extension`. |
| `check` | yes | How to verify the dep is present. See `check.type` below. |
| `remediation` | no | Short text shown in the tooltip when the check fails. |
| `remediationUrl` | no | External URL — the tree adds an "Open Remediation Link" button. |

### `check.type` values

- `exec` — run a command and parse its output. Supports optional
  `versionRegex` and `minVersion` for semver-style floor checks.
- `env` — check an environment variable is set. Supports an optional
  nested `fallback` check for when the env var is missing (use this
  for "JAVA_HOME or `java` on PATH" style checks).
- `file` — assert a path exists. `${HOME}`, `${workspaceFolder}`, and
  leading `~` are expanded.
- `nodeVersion` — compare against `process.versions.node`.
- `extensionInstalled` — `vscode.extensions.getExtension(extensionId)`
  returns a value.

### How the manager reads it

`DependencyRegistry.collect()` in the manager statically reads
`ext.packageJSON.salesforceDependencies` for every installed
extension. Disabled extensions count — we never activate the owner
just to read its manifest. Duplicate logical dependencies (two
extensions both declaring `java-jdk`) are folded by fingerprint so
the user sees one row with multiple "required by" owners in the
tooltip.

## `salesforceExtensionRequirements` (planned)

Let an extension declare which version(s) of other extensions it's
compatible with. VSCode's native `extensionDependencies` is id-only
(no semver); this contract fills the gap.

**Status:** proposed — see `PLAN.md` §9 for the design sketch. Fields
will include `id`, `versionRange` (semver range string), `severity`
(`error` / `warn`), and optional `reason`. The manager will surface
mismatches in the Groups tree and optionally block applies with
`error`-severity violations.

This doc gets a full schema section when the contract ships.

## Adoption status

Salesforce-published extensions currently declaring
`salesforceDependencies`: **TODO: audit and enumerate once we start
adopting the contract in the monorepo.** Until then, the manager
falls back to its built-in shim catalog (`src/dependencies/shimCatalog.ts`)
for common checks.
