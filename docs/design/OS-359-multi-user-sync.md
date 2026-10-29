# OS-359 Multi-user accounts, guests, roles and real-time sync (design note)

Status: design for review. No code yet. Issue: OS-359. Size: XL. This is the only feature that needs a backend. As the issue asks, the work is split into follow-up issues before any implementation starts (listed at the end).

## Goals and non-goals
- Users sign in, invite members and guests, and see each other's changes live.
- Local-only mode keeps working with no account, and remains the default.
- Non-goal for the first slice: real-time co-editing of doc text (docs keep the OS-354 merge rule), SSO/SAML, or billing.

## Backend choice
I recommend Cloudflare Workers with one Durable Object per workspace (SQLite-backed storage), with an option to self-host later.
- A Durable Object is one single-threaded actor per workspace. It holds the authoritative op log, assigns ordering, and pushes ops to connected clients over WebSockets, using hibernation so idle workspaces cost almost nothing.
- Why not plain self-hosting first: it means a server to run, patch and back up. Workers keeps operations small for a single maintainer. A self-hosted Node build of the same protocol (SQLite plus `ws`) can follow, because the server logic is a small module.
- Rejected: Firebase or Supabase realtime (a different data model, so a rewrite of sync), and peer-to-peer (no authority for permissions, OS-360).

## Sync protocol
Server-authoritative ops on top of the existing format:
- Clients already produce field-level ops with HLC stamps (`diffOps`, `applyOps`, last writer wins per field). The same ops travel over the WebSocket instead of folder segments.
- The server validates each op (auth, and later the OS-360 permissions), stamps a server sequence number, appends it to the log and broadcasts it. Clients apply ops in server order, and HLC still decides field conflicts, so the merge rules in `docs/sync.md` are unchanged.
- Catch-up: a client sends its last server sequence and gets the missing ops, or a snapshot if it is too far behind (the same idea as folder-sync compaction).
- Clock skew: the server rejects ops stamped more than 5 minutes ahead and tells the client its skew.

## Offline behaviour
Each client keeps its full local SQLite copy, as now. Offline edits queue as ops and are sent on reconnect. Conflicts resolve with the existing per-field rules. Issue numbers are assigned by the server when online; offline-created issues get a temporary key (`OS-?a1`) that is renumbered on sync.

## Identity and auth
- Sign in by email magic link (no passwords to store), with optional GitHub OAuth later.
- Sessions: a short-lived access token (JWT, 15 minutes) and a refresh token. The refresh token is stored in the desktop app with `safeStorage`.
- Roles per workspace: owner, member and guest. Guests see only the projects they are invited to. Finer rules come in OS-360.
- `me` (a display name) becomes `userId` plus a display name. Existing free-text assignee and member names are mapped to users on invite ("Link 'Sam' to sam@...").

## Migration from a single local file
"Create workspace from this data" uploads a snapshot as the first ops, using the same path as "Merge this device in" for folder sync. Folder sync and server sync are mutually exclusive per workspace, and the switch is offered in Settings. A local-only workspace never contacts the server.

## Security
- TLS only. Every op is authorised server-side. Each workspace is isolated in its own Durable Object.
- Data at rest sits on Cloudflare in plain form for the server to read. That is a step down from folder sync, where the folder holds ciphertext only. End-to-end encryption conflicts with server-side permissions, and the note should be approved with that trade-off understood.
- Secrets (the JWT signing key, the email API key) are Worker secrets set with `wrangler secret put`, never in the repo or in `wrangler.toml`.

## Accounts or tokens Ashden needs
- A Cloudflare account. Durable Objects with SQLite storage are available on the Workers Free plan; the Workers Paid plan ($5 a month) is likely needed for production limits. Pricing to be confirmed at build time.
- A Cloudflare API token for deploys, using the "Edit Cloudflare Workers" template and scoped to that account, stored as a GitHub Actions secret, not in the repo.
- A domain or `workers.dev` subdomain (the latter is free).
- An email sending service for magic links: Cloudflare Email Service or Resend, either way an API key stored as a Worker secret, plus a verified sender domain.
- Optional, later: a GitHub OAuth App (client ID and secret) for "Sign in with GitHub".

## UI touchpoints
Sign in and sign out, a workspace switcher (local or cloud), invite members and guests, a presence indicator (who's online), a "synced or offline" badge, the user picker replacing free-text assignee for cloud workspaces, and cross-user mentions and notifications.

## Test plan
- The server module runs in Miniflare/`wrangler dev` for tests.
- Protocol tests: ordering, catch-up, snapshot, skew rejection, auth failures, and guest isolation.
- Two-client integration test (like `test:sync`, over WebSockets), plus offline edits on both clients and reconnect.
- Load sanity: 10 clients and 1,000 ops.

## Follow-up issues (to file after approval)
1. Server skeleton: a Worker plus a Durable Object, the op log, and the WebSocket protocol, with tests.
2. Auth: magic link, sessions, and refresh-token storage.
3. Client transport: a WebSocket sync engine alongside folder sync, with offline queue and catch-up.
4. Workspaces, invites, roles and guests.
5. Migration from a local file, and the folder-sync/server-sync switch.
6. Users replacing free-text names, plus cross-user mentions and notifications.
7. Presence and live UI.
8. Self-hosted Node build (optional).

## Open questions for Ashden
1. Cloudflare-hosted first, or self-hosted first?
2. Is server-readable data acceptable (no end-to-end encryption), given that permissions need it?
3. Magic link only, or GitHub sign-in from day one?
4. Who are the first real users (just you plus a few people, or a team)? That decides how much of the guest and role work goes into the first slice.

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
