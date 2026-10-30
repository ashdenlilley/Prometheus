# Cloud sync (OS-359, first slice)

The sync server lives in `server/`. It is a Cloudflare Worker with two Durable Object classes:
one owner account syncs live across that owner's devices, and sign-in is by email magic link.
This document covers the server and the Electron client (`src/main/cloud.ts`, see [Client (Electron)](#client-electron)).

Deployed at `https://prometheus-sync.ashden-lilley.workers.dev` (Worker `prometheus-sync`). `server/wrangler.toml` holds the real non-secret settings; secrets are set only on the Worker. Sign-in email needs Cloudflare Email Sending onboarded for `olympusstudios.org` (Workers Paid plan).

## Architecture

- `src/index.ts` is the Worker. It routes HTTP and WebSocket requests, checks config, and sends mail.
- `Auth` (one instance, `getByName('auth')`) holds sign-in requests, rate-limit counters, devices and refresh tokens.
- `Workspace` (one instance, `getByName('default')`) holds the op log and the WebSocket hub.
- `src/shared/sync.ts` is shared with the app. The server imports only its pure helpers (`TABLE_KEYS`, `parse`) and types.
- Storage is SQLite inside each Durable Object. Migration tag `v1` creates both classes.

## Auth flow

1. `POST /auth/start {email, deviceName}` returns `{requestId, pollSecret, expiresAt, code}`. The reply is the same for the owner and for anyone else, so it reveals nothing about the account. Only when the email equals `OWNER_EMAIL` is a link emailed. `code` is a 6-digit confirmation code shown on the device.
2. The link is `${PUBLIC_URL}/auth/verify?t=<token>`. The token is 32 random bytes. Only SHA-256 hashes of the token, the code and `pollSecret` are stored.
3. `GET /auth/verify` shows a confirm page with the device name, approximate location and start time. It does not verify anything, so email link scanners that pre-fetch URLs cannot use up a link. The page needs the 6-digit code shown on the device. Its "Confirm sign-in" button `POST`s the token and code to `/auth/verify`, and only a matching code verifies. Five wrong codes burn the request.
4. The device polls `POST /auth/poll {requestId, pollSecret}`:
   - `202 {status:'pending'}` until verified.
   - `200 {refreshToken, accessToken, accessExpiresAt, deviceId}` exactly once. This creates the device session.
   - `410` after that, or when the link expired. `404` for an unknown request or a wrong `pollSecret`.
5. Links expire after 15 minutes (`LINK_TTL_SECONDS`) and work once.
6. Rate limits, counted per 15 minutes: 5 starts per email and 20 per IP (`CF-Connecting-IP`). Over the limit gives `429` with `Retry-After`. The count includes non-owner starts, so the limit does not reveal the owner either.

### Tokens

- Access token: HS256 JWT signed with `JWT_SECRET`, header `kid` = `1`. Claims: `iss` = the `PUBLIC_URL` origin, `aud` = `prometheus-sync`, `sub` = user id (must still be the device's user), `dev` = device id, `iat`, `exp` (15 minutes). Verified with WebCrypto `subtle.verify` (constant time). `alg` other than `HS256` is rejected, including `none`, and so is a wrong `iss`, `aud` or `kid`. `JWT_SECRET_PREVIOUS`, if set, is also accepted for verification (rotation); new tokens are always signed with `JWT_SECRET`. Tokens in the old shape (no `kid`, `sub` = `owner`, no `iss`/`aud`) are accepted only while their `exp` is at most 15 minutes away, so tokens issued before OS-466 keep working until they expire; remove this in a later release.
- Refresh token: opaque, 32 random bytes. `POST /auth/refresh {refreshToken}` rotates it and returns a new access token. The old token stops working at once. A device that has not refreshed for `REFRESH_IDLE_DAYS` (default 60) is refused (`401`) and revoked, so it must sign in again.
- Reuse: presenting a retired refresh token revokes that device, since the token was probably stolen. Its sockets are closed, and the device loses access immediately.
- Every bearer request also checks that the device is not revoked. Revocation therefore takes effect on the next request, not at token expiry.

### Device management

- `GET /devices` (bearer): `[{id, name, createdAt, lastSeenAt, current}]`.
- `DELETE /devices/:id` (bearer): revokes that device and closes its WebSockets with code `4001`. Unknown id is `404`.
- `POST /auth/signout-all` (bearer): revokes every device.

## Sync protocol

Endpoint: `GET /sync` with a WebSocket upgrade. Authenticate with a single-use ticket:

1. `POST /sync/ticket` (bearer): returns `{ticket}`. The ticket is 32 random bytes, stored only as a hash, and expires after `SYNC_TICKET_TTL_SECONDS` (default 60 s).
2. Open the socket with `Sec-WebSocket-Protocol: prometheus-sync, ticket.<ticket>`. A ticket opens one socket; a second use is `401`.

The server replies with the subprotocol `prometheus-sync`. The ticket is never echoed back.
`bearer.<token>` was removed in OS-466 (its header is logged in clear text) and gets `401`. `?access_token=` is not accepted either.

All frames are JSON text.

Client to server:

| Frame | Meaning |
|---|---|
| `{type:'hello', since}` | `since` = last server seq the client applied (`0` = none). Send once per connection, first. |
| `{type:'push', id, ops}` | `id` is a client-chosen string, unique per device. At most 1000 ops. |
| `{type:'ping'}` | Liveness. |

Server to client:

| Frame | Meaning |
|---|---|
| `{type:'snapshot', ops, head}` | Only when `since` is older than the compaction floor. Compacted ops, in chunks of at most 500. Apply like any op. |
| `{type:'ops', ops:[{seq, op}], head}` | Ops in seq order, at most 500 per frame. Sent for catch-up and for broadcasts from other devices. |
| `{type:'ready', head}` | Catch-up is complete. The client's last applied seq is now `head`. |
| `{type:'ack', id, seqs, head}` | Push accepted. `seqs` are the seqs of its ops, in order. A retried push gets the same ack. |
| `{type:'error', id?, code, ...}` | Push or frame rejected. See codes below. |
| `{type:'pong', now}` | Reply to ping. |

Error codes:

- `skew` with `skewMs`: an op's hlc is more than 5 minutes ahead of server time. The whole push is rejected.
- `invalid` with `index` and `message`: an op failed shape checks (unknown table, bad id or hlc, bad fields). The whole push is rejected.
- `bad_request`, `bad_json`, `too_large` (over 1 MB), `unknown_type`.

Rules:

- Ops are stored and broadcast as sent. Merge rules are unchanged from [`sync.md`](./sync.md): per-field highest hlc wins, and a row delete beats older field edits.
- A push is appended in one transaction. Seqs are strictly increasing.
- Broadcasts go to the other sockets that have finished `hello`. The sender is not sent its own ops.
- Push ids are kept for 24 hours per device, so a retry after reconnect is idempotent.

### Compaction

When the log holds more than `COMPACT_AT` ops (default 10,000), ops older than the newest `COMPACT_KEEP` (default 2,000) are folded. For each row and field the winning op (highest hlc) is kept. Row existence is kept as a create or a delete. A deleted row keeps no fields. The folded ops are deleted and the floor is raised. Clients behind the floor get the snapshot first.

Tests set small values through the Miniflare bindings.

## Configuration

Settings come from `wrangler.toml` `[vars]` and from secrets. A request that finds a required setting missing gets `500 {error:'config_missing', message:'Missing setting: NAME'}`. The value is never echoed.

| Name | Where | Notes |
|---|---|---|
| `OWNER_EMAIL` | var | The only account allowed to sign in. |
| `PUBLIC_URL` | var | Base URL used in sign-in links. |
| `EMAIL_PROVIDER` | var | `resend` or `cloudflare`. `log` is local development only. |
| `EMAIL_FROM` | var | Sender on a verified domain. |
| `EMAIL` | binding | `send_email` binding, only for `EMAIL_PROVIDER = "cloudflare"`. No key. |
| `JWT_SECRET` | secret | Signs access tokens. 64 random hex characters (at least 32). The Worker refuses to run (500, `config_missing`) while any setting still holds its placeholder value or `JWT_SECRET` is shorter than 32 characters. |
| `JWT_SECRET_PREVIOUS` | optional secret | Verify-only, for rotation: put the old secret here and the new one in `JWT_SECRET`, then delete it 15 minutes later. At least 32 characters if set. |
| `EMAIL_API_KEY` | secret | Resend API key. Only for `EMAIL_PROVIDER = "resend"`. |
| `LINK_TTL_SECONDS`, `COMPACT_AT`, `COMPACT_KEEP` | optional var | Defaults 900, 10000, 2000. The sign-in email states the link lifetime in minutes from `LINK_TTL_SECONDS`. |
| `REFRESH_IDLE_DAYS` | optional var | Default 60. A device idle longer than this must sign in again. |

Secrets never go in `wrangler.toml` or in the repo.

## Email

`src/email.ts` sends the magic link through an `EmailSender` chosen by `EMAIL_PROVIDER`:

- `resend`: `POST https://api.resend.com/emails`, bearer `EMAIL_API_KEY`.
- `cloudflare`: Cloudflare Email Sending through the Workers `send_email` binding `EMAIL` (`env.EMAIL.send(...)`). No REST call and no API key. A failure throws with the error code only (for example `E_SENDER_NOT_VERIFIED`).
- `log`: local development only. Prints `sign-in link for <email>: <link>` to the console and sends nothing. It throws unless `PUBLIC_URL` starts with `http://127.0.0.1` or `http://localhost`.

Any other value, or a missing key or binding for the chosen provider, gives the `config_missing` reply.

A failed send still returns `200` to the client, so the reply stays uniform. The failure is logged with its HTTP status only. Neither the token nor the link is logged.

## Security notes

- Only hashes of tokens and poll secrets are stored. Refresh tokens are stored as hashes too.
- The owner's data is readable by the server. This is the trade-off accepted in [`design/OS-359-multi-user-sync.md`](./design/OS-359-multi-user-sync.md). Folder sync stays ciphertext-only.
- The verify page uses a strict CSP, `no-referrer`, and escapes every value.
- Errors are logged by message only.
- Workers Logs keep request logs. Query strings are redacted (`observability.redact_query_string`), and the `Authorization` header is masked. The `Sec-WebSocket-Protocol` header is not masked, so the sync socket's credential appears there in clear text. A ticket is single use and expires after 60 s, so a logged ticket is useless once it has been used.
- `bearer.<token>` is removed, so no access token reaches the logs through the socket header.
- `?access_token=` is gone. It was logged in the URL.
- Tests need no backdoor. The email API is stubbed at the outbound fetch level (Miniflare `outboundService`).

## Local development

```sh
cd server
npm install
cp .dev.vars.example .dev.vars   # then edit: JWT_SECRET and EMAIL_API_KEY values
npx wrangler dev
```

`npx wrangler dev` runs the Worker locally. In `.dev.vars` set `EMAIL_PROVIDER=log` and `PUBLIC_URL=http://127.0.0.1:8787` (the local dev URL), and the sign-in link is printed to the dev console. Without it, a sign-in email cannot be delivered; the test harness also reads the link directly.

## Client (Electron)

The client is `src/main/cloud.ts` (class `CloudSync`). It has no Electron imports, so `tests/main/cloud.test.ts` runs it in plain Node. `src/main/index.ts` wires it up and `src/renderer/src/components/CloudSyncSettings.tsx` is the Settings UI.

### Where state lives

| File (in the app's data dir) | Holds | Secret? |
|---|---|---|
| `cloud-sync.json` | server URL, email, device id and name, `lastSeq`, `enabled`, `joined` | No |
| `cloud-outbox.json` | ops not yet acked, and the id of the push in flight | No (ops are the user's data) |
| `cloud-credentials.json` | the refresh token, under `cloud.refreshToken`, sealed by `safeStorage` | Yes, keychain-sealed |
| `prometheus.db` (`sync_clock`) | per-field hlc clocks, shared with folder sync | No |

- The access token (15 minutes) is kept in memory only. Refresh rotates the refresh token, and the new one is saved before the new access token is used.
- Config and outbox are never written with tokens. Logs carry codes and messages only.
- Sign-out (`signOut`) revokes this device on the server when it can be reached, deletes the refresh token, clears the outbox and config, and keeps all local data.

### Keychain requirement

Sign-in is refused unless `safeStorage` has a keychain: `isAsyncEncryptionAvailable()` must be true, and on Linux the backend must not be `basic_text`. The refusal message says so. Nothing is written in plain text.

Test-only escape hatch: `PROMETHEUS_CLOUD_ALLOW_INSECURE_TEST=1` allows sign-in without a keychain and stores the refresh token in plain text in `cloud-credentials.json`. Use it only on a machine without a keychain, for testing. Never set it for a release build.

### Joining and the first connection

- After sign-in the client connects once and reads the server head. An empty server is merged automatically, because there is nothing to choose from.
- If the server already has data, status shows `needsJoin`. The user picks:
  - **Merge** sends this device's data as a snapshot (`snapshotOps`), then catches up with the server's ops under the usual per-field rules.
  - **Adopt** clears local clocks, replaces local data with the empty workspace, and replays the server's ops from `since: 0`. Local edits made before the choice are discarded.
- Until a join, nothing is pushed and no remote op is applied.

### Offline queue

- Local ops are stamped once, by the folder engine's `record()`. Cloud `record()` only queues them. A local edit made while offline is in the outbox and is persisted at once.
- Pushes go out in batches of at most 1,000 ops, one batch in flight at a time. The batch id is persisted with the batch, so a retry after a dropped connection reuses the id. The server then acks the retry without storing it twice.
- `ack` removes the batch. `invalid` (and any other rejection) drops the batch and sets an error that says how many changes were lost, so the client does not loop on it.
- `skew` keeps the batch and sets an error that names the clock. It is retried on the next connection, once the clock is fixed.
- Reconnects use exponential backoff from 1 s to 60 s. A ping goes every 30 s. After `ready`, an unacked batch is sent again with its original id.

### Folder sync and cloud sync are exclusive

Only one can be on. The check lives in main, not only in the UI:

- `cloud:signIn` throws "Turn off folder sync first." while folder sync is on.
- `sync:join` throws "Turn off cloud sync first." while cloud sync is on or a sign-in is waiting.

"Turn off cloud sync" is sign-out. The local data stays on this device.

### Errors the user sees

- "This device was signed out. Sign in again." after a `4001` close (the device was revoked elsewhere), or after a refresh returns `401`. The refresh token is deleted, and local data stays.
- Sign-in messages: the link expired or was already used (`410`), the request was not found (`404`), it timed out after 15 minutes, or too many links were requested (`429`).

## Collaboration and permissions (OS-360, first slice)

Design: `docs/design/OS-360-permissions.md`. Rules live in `src/shared/permissions.ts` and are enforced by the Workspace Durable Object on every push; the client UI only hides what the server would refuse.

**Roles.** `owner` (the `OWNER_EMAIL` account; everything), `member` (read/write every visible project), `guest` (read/write issues, docs and git links only in the projects in their grant; can read spaces and teams), `viewer` (read-only; every push is refused). Webhooks, integrations, agents and project access settings are owner-only. Only the owner invites people, changes roles and removes members.

**Invites.** `POST /invites {email, name?, role, projects?}` (owner) emails a single-use link (`kind: invite`; the log provider prints `invite link for <email>: <url>`). It expires after 7 days (`INVITE_TTL_SECONDS`). Opening the link shows a confirm page; accepting creates the user, who then signs in with the normal magic link. Rate limits: 5 invites per address and 20 per IP per 15 minutes. `GET /members` lists members (emails for the owner only) and pending invites; `PATCH`/`DELETE /members/:id` and `DELETE /invites/:id` manage them. Removing a member revokes all their devices (close 4001).

**Project visibility.** A project with `access: {mode: 'restricted', users: [...]}` is invisible (not just locked) to everyone except the owner and the listed users; guests additionally need the project in their grant. Rows are filtered per user in snapshots, history and live broadcasts by the row's current project (issues, cycles, docs, automations, ...; git links and notifications via their issue).

**Refusals.** A refused push batch is rolled back atomically and answered with `{type:'error', code:'forbidden', index, message}`; the client drops that batch and reloads from the server, so the local edit is undone and the user sees "Not allowed: ...". Refusals are logged server-side (`GET /audit/denials`, owner only, last 1000).

**Access changes.** When a role, grant or project visibility changes, affected non-owner sockets close with code 4003. The client clears its local copy and resyncs from 0, then re-applies unsent outbox edits on top. Owners are never affected.

**Presence.** After `ready` the client sends `{type:'presence', issueId}`; the server broadcasts `{type:'presence', users}` (only users who can see the issue get its id). The issue panel shows "Also viewing", and settings show "Online now".

**Joining as an invited user.** A non-owner whose device has data must replace it with the workspace copy; a backup (`cloud-backup-<ms>.json` in the data folder) is written before every adopt.

**Known limitations.** Downgrading a user does not purge data already on their device (removing them signs them out). Changing `OWNER_EMAIL` to an existing member's address is not supported. Read-only guests and team-based visibility are follow-ups.

## Testing

```sh
cd server
npm ci
npm test         # builds dist/worker.js, then runs test/*.test.mjs with node:test and Miniflare
npm run typecheck
```

- `test/auth.test.mjs`: health, missing config, emails, verify and poll, expiry, reuse, rate limits, JWT rejection, refresh rotation, devices, signout-all.
- `test/sync.test.mjs`: upgrade auth (tickets, single use, expiry, revoked device, bearer. refused), catch-up, push ack and broadcast, skew, invalid ops, idempotent pushes, ordering, compaction and snapshot catch-up, socket close on revoke, and a load check (3 sockets, 1,000 ops).
- `test/client.test.mjs`: two real `CloudSync` clients (bundled from `src/main/cloud.ts` with esbuild) against Miniflare on `127.0.0.1` with a random port. Device A merges, B adopts, live edits flow both ways, A goes offline, edits twice and reconnects, and B receives both in order. A then revokes B, and B is signed out.
- `tests/main/cloud.test.ts` (run by `npm run test:unit` from the repo root): URL rules, sign-in polling and its errors, the refresh token living only in credentials, the outbox surviving a restart, push-id reuse on retry, push pacing under the server quota (batches of at most 500, at most 18 pushes per 10 s and 4,500 ops per minute), `rate_limited` backoff and resend, one delayed reconnect after `4008`, skew and invalid handling, `4001` sign-out, and merge versus adopt. It uses a fake fetch and a fake WebSocket.

CI runs the same tests in the `server` job of `.github/workflows/ci.yml`. CI never deploys.

## Deploying (Ashden, later)

Nothing is deployed yet. These steps are for later, on Ashden's machine.

1. Create a Cloudflare account. Note the account id from the dashboard. Enable the Workers plan that supports Durable Objects with SQLite.
2. Choose a `workers.dev` subdomain in the dashboard (free).
3. Log in from the server directory: `cd server && npx wrangler login`. This is interactive and runs on Ashden's machine only.
4. Edit `server/wrangler.toml`. Replace `you@example.com`, `REPLACE_WITH_SUBDOMAIN` and `REPLACE_WITH_VERIFIED_DOMAIN`. Pick `EMAIL_PROVIDER`:
   - Resend: set `EMAIL_PROVIDER = "resend"`. Verify the sender domain (SPF and DKIM records on a domain you control) and create an API key.
   - Cloudflare: set `EMAIL_PROVIDER = "cloudflare"`, uncomment the `[[send_email]]` block, and onboard the sender domain to Email Sending in the dashboard. No API key is needed.
5. Verify the sender domain before the first sign-in: for Resend, the SPF and DKIM records; for Cloudflare, Email Sending onboarding.
6. Set the secrets. Each command prompts for the value:
   ```sh
   npx wrangler secret put JWT_SECRET       # 64 random hex characters
   npx wrangler secret put EMAIL_API_KEY    # Resend only; skip for Cloudflare
   ```
7. Deploy: `npx wrangler deploy`. Then check `https://prometheus-sync.REPLACE_WITH_SUBDOMAIN.workers.dev/health` returns `{"ok":true}`.
8. Optional, GitHub Actions deploys: create an API token in the Cloudflare dashboard from the "Edit Cloudflare Workers" template, scoped to this account. Store it as the repo secret `CLOUDFLARE_API_TOKEN`, and store the account id as `CLOUDFLARE_ACCOUNT_ID`. The workflow `.github/workflows/deploy-sync-server.yml` runs only from the Actions tab (`workflow_dispatch`). It runs the tests, then `npx wrangler deploy`.

Never paste the token or secrets into the repo, into issues, or into chat.
