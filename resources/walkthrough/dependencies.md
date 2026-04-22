# Verify dependencies

Each Salesforce extension depends on external tools — the Salesforce CLI,
Java for Apex, Node for LWC test, etc. The Dependencies view in the
activity bar surfaces their current status.

## How checks are discovered

1. Every installed extension's `package.json` is scanned for a top-level
   `salesforceDependencies` array (read statically — no activation required,
   so even disabled extensions contribute).
2. Built-in CLI / runtime checks (`sf`, `git`, Node) are always added.
3. For extensions that haven't adopted the contract yet, a built-in
   **shim catalog** fills in known-good checks (e.g., Java for
   `salesforcedx-vscode-apex`).

## Declaring a dependency in your own extension

```jsonc
{
  "name": "my-salesforce-extension",
  "salesforceDependencies": [
    {
      "id": "java-jdk",
      "label": "Java JDK 11+",
      "category": "runtime",
      "check": {
        "type": "env",
        "env": "JAVA_HOME",
        "fallback": { "type": "exec", "command": "java", "args": ["-version"], "minVersion": "11.0.0" }
      },
      "remediation": "Install Temurin 17+ and set JAVA_HOME",
      "remediationUrl": "https://adoptium.net/"
    }
  ]
}
```

Supported `check.type` values: `exec`, `env`, `file`, `nodeVersion`, `extensionInstalled`.

## Commands

- `SFDX Manager: Run Dependency Check` — re-runs every check; shows a summary toast.
- `SFDX Manager: Copy Dependency Report` — markdown report to clipboard, great for bug reports.
