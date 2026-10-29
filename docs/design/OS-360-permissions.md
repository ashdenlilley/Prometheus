# OS-360 Multi-user collaboration and permissions per board and column (design note)

Status: design for review. No code yet. Issue: OS-360. Size: XL overall, split into the follow-ups below (permissions alone is about L). Blocked by OS-359 (single-account cloud sync) and OS-353 (teams).

## Scope change
After the OS-359 revision (#48), OS-359 ships one account (Ashden) syncing across his own devices. Everything that brings in other people now lives here, on top of that server and sync:
- Accounts for other people, sign-in by email magic link (optionally GitHub later), and invites to a workspace.
- Roles and guests, and the permission rules below.
- Presence (who is online, who is viewing an issue).
- User pickers: `me` and free-text assignee/member names become `userId` plus a display name in cloud workspaces. Existing names are mapped on invite ("Link 'Sam' to sam@...").
- Cross-user mentions and notifications.

## Why it waits for OS-359
In a single-user local app, every "permission" can be bypassed by editing the local file, so enforcement only means something on a server. OS-359 provides that server, the op log and device auth; this feature adds users and rules to it.

## Accounts, invites and sign-in
- The owner (Ashden, already paired through OS-359) invites someone by email with a role. The invite is a single-use link, valid 7 days, sent by magic link.
- A new user signs in with a magic link on each device. Sessions reuse OS-359's model: per-device refresh token in `safeStorage`, 15-minute access tokens, revocable.
- `Membership { userId, workspaceId, role }` is added on the server; removing a member revokes their sessions and stops their sync immediately.

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
Membership { userId, workspaceId, role }   // server-side, new here
User { id, email, displayName }            // server-side, new here
Issue.assignee / members: userId in cloud workspaces (free text stays in local-only ones)
```
Optional fields only. Rules are synced like other settings, but only owners and team admins can change them; the server enforces that.

## Presence
Each connected session reports `{ userId, issueId? }` to the workspace Durable Object, which broadcasts a small presence list. It is not stored and is not an op. Viewers and guests only see presence inside projects they can see.

## UI touchpoints
Workspace settings > Members (invite, change role, remove), sign-in by magic link, user pickers in assignee/member fields and mentions, presence avatars on the board and issue panel, notifications for mentions, Project settings > Access, the column menu (read-only/hidden per role), a lock icon on restricted projects and read-only cells, and an explanation when an action is refused.

## Security
- Deny by default for guests.
- Invite and magic links are single use, expire, and are rate-limited per email and per IP.
- Hidden data is never sent to the client.
- Every refusal is logged in the audit log (OS-351).
- A rule change takes effect on the server first, then clients resync.

## Accounts or tokens Ashden needs
These moved here from OS-359:
- An email sending service for invites and magic links: Cloudflare Email Service or Resend, with an API key stored as a Worker secret (`wrangler secret put`), never in the repo, plus a verified sender domain (SPF/DKIM records on a domain Ashden controls).
- Optional: a GitHub OAuth App (client ID and secret, as Worker secrets) for "Sign in with GitHub".
- Possibly the Workers Paid plan ($5 a month) once several users are active; to be confirmed against the free limits.

## Test plan
- Unit tests of the pure rule function, as a matrix of role × project mode × column rule × operation.
- Server-side tests: a viewer's op is rejected; a guest's snapshot excludes restricted projects and hidden columns; a webhook and an MCP query don't leak restricted data; an agent capped by its creator's role.
- Invites: expiry, single use, wrong-email rejection, member removal revoking sessions.
- Presence: join/leave broadcast, no presence leak from restricted projects.
- Two-user integration test over WebSockets: live edits, a mention notification, and a viewer refused.
- UI tests are secondary.

## Follow-up issues (to file after approval)
1. Accounts, magic-link sign-in and invites (moved from OS-359).
2. Users replacing free-text names, user pickers, cross-user mentions and notifications (moved from OS-359).
3. Presence and live UI (moved from OS-359).
4. Roles, guests and server-side enforcement with the shared rule function.
5. Restricted projects and column rules, with their UI.

## Open questions for Ashden
1. Are owner, member, viewer and guest enough, or do you need custom roles?
2. Should hidden columns be hidden per role only, or per named user too?
3. Should restricted projects be invisible, or visible by name but locked?
4. Magic link only, or GitHub sign-in too? (Moved from OS-359.)
5. Who are the first people you would invite? That decides whether guests and column rules are in the first slice or can wait.

## Dependencies and suggested build order

Suggested order for the eight remaining features (each starts only after its design note is approved):

1. OS-353 Teams: no dependencies. Gives later features a stable "team" owner.
2. OS-354 Documents: project and space docs need nothing; team docs need OS-353.
3. OS-355 Agents as assignees: builds on the existing MCP server. Introduces the "actor" idea that OS-360 reuses for multiple users.
4. OS-356 Webhooks and local REST API: builds on the MCP tool layer. Introduces the shared credential store and the outgoing-HTTP delivery queue.
5. OS-357 Git integration: reuses the credential store from OS-356.
6. OS-358 Third-party integrations: reuses the credential store and delivery queue from OS-356, and the link model from OS-357.
7. OS-359 Cloud sync, single account first: one account syncing live across Ashden's devices. Its first slice needs no other feature (OS-353 and OS-355 data simply sync like any other rows), so it can be pulled earlier if live sync matters more. It introduces the backend.
8. OS-360 Multi-user collaboration and permissions: invites, accounts, guests, roles, presence, user pickers and enforcement. Needs OS-359 (server, op log, device auth) and OS-353 (team roles); uses OS-355's actor model for agents.

Items 1 to 6 keep Prometheus single-user and local-first. Item 7 adds an optional backend but stays single-user. Item 8 is where Prometheus becomes multi-user.
