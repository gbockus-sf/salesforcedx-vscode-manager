# Apply an extension group

Groups are named sets of Salesforce VSCode extensions — e.g., **Apex** when
you're writing server-side code, **Lightning** for LWC/Aura work, or a
**Custom** group you defined yourself.

## Built-in groups

| Group | Members |
|---|---|
| **Apex** | core, apex, apex-debugger, apex-replay-debugger, apex-log, apex-oas, apex-testing, soql, visualforce, redhat.vscode-xml |
| **Lightning** | core, services, lightning, lwc, eslint, prettier, lightning-design-system |
| **React** | empty by default — edit to add members |

## Apply scope

Controlled by the setting `salesforcedx-vscode-manager.applyScope`:

- `disableOthers` *(default)* — enable members, uninstall any managed extension that isn't in the group.
- `enableOnly` — enable members, leave everything else alone.
- `ask` — prompt per apply; remembered per group.

## Commands

- `SFDX Manager: Apply Group...` — pick any group from a Quick Pick.
- `SFDX Manager: Create Custom Group` — multi-select members.
- `SFDX Manager: Edit Group` / `Delete Group` — built-ins revert on delete.
