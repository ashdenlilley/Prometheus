# OS-360 Permissions per board and column (design note)

Status: design for review. No code yet. Issue: OS-360. Size: L. Blocked by OS-359 (multi-user) and OS-353 (teams).

## Why it waits for OS-359
In a single-user local app, every "permission" can be bypassed by editing the local file, so enforcement only means something on a server. This note fixes the model now so OS-359 doesn't paint it into a corner.

## Role model
- Workspace roles: owner (everything, including billing and deleting the workspace), member (create and edit in the projects they can see), viewer (read only), and guest (only the projects they are invited to, with member or viewer rights there).
- Team roles (OS-353): team admin (workflow, members) and team member.
- Agents (OS-355) and API tokens (OS-356) act as their own principal with their level ("read", "comment", "write"), capped by the role of the user who created them.

## Board (project) rules
A project is either open to the workspace (the default) or restricted to listed users, teams and roles. In a restricted project, a non-listed user cannot see it in lists, search, notifications, webhooks or MCP results.

## Column rules
Per custom column and per fixed field: editable by members, read-only for some roles, or hidden from some roles. Hidden values are stripped from the data sent to those clients, not just hidden in the UI.

## Where rules are enforced
- Server (authoritative): the OS-359 Durable Object checks every incoming op against the rules and rejects with a reason, and filters outgoing ops and snapshots per user (restricted projects and hidden columns removed).
- Client: the same rule function (`src/shared/permissions.ts`, a pure function) greys out or hides controls. It is for user experience only.
- Local MCP and REST on a cloud workspace act as the signed-in user, capped further by the agent's level. Local-only workspaces have no enforcement, and the UI says so.

## Data model
```
Project.access?: { mode: 'open' | 'restricted'; users: string[]; teams: string[] }
Column.access?: { readOnlyFor?: Role[]; hiddenFor?: Role[] }   // also for fixed fields via Project.fieldAccess
Membership { userId, workspaceId, role }   // from OS-359
```
Optional fields only. Rules are synced like other settings, but only owners and team admins can change them; the server enforces that.

## UI touchpoints
Project settings > Access, the column menu (read-only/hidden per role), a lock icon on restricted projects and read-only cells, and an explanation when an action is refused.

## Security
- Deny by default for guests.
- Hidden data is never sent to the client.
- Every refusal is logged in the audit log (OS-351).
- A rule change takes effect on the server first, then clients resync.

## Accounts or tokens Ashden needs
None beyond OS-359.

## Test plan
- Unit tests of the pure rule function, as a matrix of role × project mode × column rule × operation.
- Server-side tests: a viewer's op is rejected; a guest's snapshot excludes restricted projects and hidden columns; a webhook and an MCP query don't leak restricted data; an agent capped by its creator's role.
- UI tests are secondary.

## Open questions for Ashden
1. Are owner, member, viewer and guest enough, or do you need custom roles?
2. Should hidden columns be hidden per role only, or per named user too?
3. Should restricted projects be invisible, or visible by name but locked?

## Dependencies and suggested build order

Suggested order for the eight remaining features (each starts only after its design note is approved):

1. OS-353 Teams: no dependencies. Gives later features a stable "team" owner.
2. OS-354 Documents: project and space docs need nothing; team docs need OS-353.
3. OS-355 Agents as assignees: builds on the existing MCP server. Introduces the "actor" idea that OS-359 reuses.
4. OS-356 Webhooks and local REST API: builds on the MCP tool layer. Introduces the shared credential store and the outgoing-HTTP delivery queue.
5. OS-357 Git integration: reuses the credential store from OS-356.
6. OS-358 Third-party integrations: reuses the credential store and delivery queue from OS-356, and the link model from OS-357.
7. OS-359 Multi-user and real-time sync: needs OS-353 (membership becomes real accounts) and OS-355 (actor attribution). The only item that needs a backend.
8. OS-360 Permissions: needs OS-359 (server-side enforcement needs a server and real identities) and OS-353 (team roles).

Items 1 to 6 keep Prometheus single-user and local-first. Items 7 and 8 change that and should be decided together.
