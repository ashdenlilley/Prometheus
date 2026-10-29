# OS-359 Multi-user accounts, guests, roles and real-time sync (design note)

Status: design for review. No code yet. Issue: OS-359. Size: the full feature is XL; the first slice below is about L (5 to 7 days). This is the only feature that needs a backend. As the issue asks, the work is split into follow-up issues before any implementation starts (listed at the end).

## Decisions
- Decided (Ashden): Cloudflare-hosted backend (Workers plus Durable Objects).
- Decided (Ashden): data on the server is readable by the server (no end-to-end encryption). See Security.
- Decided (Ashden): the first and, initially, only user is Ashden. The first slice is one account syncing live across his own devices.

## Goals and non-goals
- First slice: Ashden signs in on each of his devices and sees changes live on the others, with offline edits merged on reconnect.
- Local-only mode keeps working with no account, and remains the default.
- Moved out of the first slice: invites, other users, guests and roles (to OS-360 and the follow-ups), presence, user pickers and cross-user mentions.
- Non-goal: real-time co-editing of doc text (docs keep the OS-354 merge rule), SSO/SAML, or billing.

## Backend
Cloudflare Workers with one Durable Object per workspace (SQLite-backed storage), as decided. A self-hosted build stays possible later.
- A Durable Object is one single-threaded actor per workspace. It holds the authoritative op log, assigns ordering, and pushes ops to connected clients over WebSockets, using hibernation so idle workspaces cost almost nothing.
- Why not plain self-hosting first: it means a server to run, patch and back up. Workers keeps operations small for a single maintainer. A self-hosted Node build of the same protocol (SQLite plus `ws`) can follow, because the server logic is a small module.
- Rejected: Firebase or Supabase realtime (a different data model, so a rewrite of sync), and peer-to-peer (no authority for permissions, OS-360).

## Sync protocol
Server-authoritative ops on top of the existing format:
- Clients already produce field-level ops with HLC stamps (`diffOps`, `applyOps`, last writer wins per field). The same ops travel over the WebSocket instead of folder segments.
- The server validates each op (auth now; the OS-360 permissions once there are other users), stamps a server sequence number, appends it to the log and broadcasts it. Clients apply ops in server order, and HLC still decides field conflicts, so the merge rules in `docs/sync.md` are unchanged.
- Catch-up: a client sends its last server sequence and gets the missing ops, or a snapshot if it is too far behind (the same idea as folder-sync compaction).
- Clock skew: the server rejects ops stamped more than 5 minutes ahead and tells the client its skew.

## Offline behaviour
Each client keeps its full local SQLite copy, as now. Offline edits queue as ops and are sent on reconnect. Conflicts resolve with the existing per-field rules. Issue numbers keep the existing rule from folder sync and OS-353: a number clash between two of Ashden's devices is resolved on merge for the newer issue. Server-assigned numbers can wait for multiple users.

## Identity and auth (single user)
- One owner account. No sign-up, no email and no invites in the first slice.
- First device: Ashden generates an owner setup secret locally and stores it as a Worker secret (`wrangler secret put OWNER_SETUP_SECRET`). Entering it once in the app registers that device. The secret is never in the repo and can be rotated.
- More devices: a signed-in device shows a one-time pairing code (6 to 8 characters, valid 5 minutes, single use) that the new device enters.
- Each device gets its own refresh token, stored with `safeStorage`, plus short-lived access tokens (15 minutes). Settings lists devices and can revoke one.
- Free-text assignee and member names stay as they are. Accounts for other people, magic-link sign-in, roles and guests come with OS-360.

## Migration from a single local file
"Create workspace from this data" uploads a snapshot as the first ops, using the same path as "Merge this device in" for folder sync. Folder sync and server sync are mutually exclusive per workspace, and the switch is offered in Settings. A local-only workspace never contacts the server.

## Security
- TLS only. Every op is authorised server-side. Each workspace is isolated in its own Durable Object.
- Data at rest sits on Cloudflare in plain form for the server to read. That is a step down from folder sync, where the folder holds ciphertext only. Ashden has accepted this trade-off; it keeps the door open for server-side permissions (OS-360).
- Pairing codes are rate-limited and single use; a revoked device's refresh token stops working immediately.
- Secrets (the JWT signing key and the owner setup secret) are Worker secrets set with `wrangler secret put`, never in the repo or in `wrangler.toml`.

## Accounts or tokens Ashden needs
- A Cloudflare account. Durable Objects with SQLite storage are available on the Workers Free plan, which is likely enough for one user; the Workers Paid plan ($5 a month) would only be needed if the free limits are hit. To be confirmed at build time.
- A Cloudflare API token for deploys, using the "Edit Cloudflare Workers" template and scoped to that account, stored as a GitHub Actions secret, not in the repo.
- A domain or `workers.dev` subdomain (the latter is free).
- Nothing else for the first slice. No email service or sender domain is needed, because there is no magic link yet.
- Later, with other users (OS-360 and follow-ups): an email sending service (Cloudflare Email Service or Resend) API key plus a verified sender domain for magic links, and optionally a GitHub OAuth App.

## UI touchpoints
First slice: connect this workspace to the cloud (setup secret or pairing code), a devices list with "pair a device" and "revoke", sign out, and a "synced or offline" badge. Later: invites, presence, user pickers and cross-user mentions.

## Test plan
- The server module runs in Miniflare/`wrangler dev` for tests.
- Protocol tests: ordering, catch-up, snapshot, skew rejection, auth failures, pairing-code expiry and reuse, and device revocation.
- Two-device integration test (like `test:sync`, over WebSockets), plus offline edits on both devices and reconnect.
- Load sanity: 3 devices and 1,000 ops.

## Follow-up issues (to file after approval)
First slice (single user):
1. Server skeleton: a Worker plus a Durable Object, the op log, and the WebSocket protocol, with tests.
2. Auth: owner setup secret, device pairing, sessions and refresh-token storage, device revocation.
3. Client transport: a WebSocket sync engine alongside folder sync, with offline queue and catch-up.
4. Migration from a local file, and the folder-sync/server-sync switch.

Later (when other people join, with OS-360):
5. Magic-link accounts, invites, roles and guests.
6. Users replacing free-text names, plus cross-user mentions and notifications.
7. Presence and live UI.
8. Self-hosted Node build (optional).

## Open questions for Ashden
1. Is a setup secret plus device pairing codes acceptable for signing in your own devices, instead of email magic links?
2. When other people join later: magic link only, or GitHub sign-in too?

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
