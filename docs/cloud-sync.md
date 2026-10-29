# Cloud sync server (OS-359, first slice)

The sync server lives in `server/`. It is a Cloudflare Worker with two Durable Object classes:
one owner account syncs live across that owner's devices, and sign-in is by email magic link.
This document covers the server. The Electron client is not part of this slice.

Nothing here is deployed. Every account id, domain, email and key in the repo is a placeholder.

## Architecture

- `src/index.ts` is the Worker. It routes HTTP and WebSocket requests, checks config, and sends mail.
- `Auth` (one instance, `getByName('auth')`) holds sign-in requests, rate-limit counters, devices and refresh tokens.
- `Workspace` (one instance, `getByName('default')`) holds the op log and the WebSocket hub.
- `src/shared/sync.ts` is shared with the app. The server imports only its pure helpers (`TABLE_KEYS`, `parse`) and types.
- Storage is SQLite inside each Durable Object. Migration tag `v1` creates both classes.

## Auth flow

1. `POST /auth/start {email, deviceName}` returns `{requestId, pollSecret, expiresAt}`. The reply is the same for the owner and for anyone else, so it reveals nothing about the account. Only when the email equals `OWNER_EMAIL` is a link emailed.
2. The link is `${PUBLIC_URL}/auth/verify?t=<token>`. The token is 32 random bytes. Only SHA-256 hashes of the token and of `pollSecret` are stored.
3. `GET /auth/verify` shows a confirm page. It does not verify anything, so email link scanners that pre-fetch URLs cannot use up a link. The "Confirm sign-in" button `POST`s the token to `/auth/verify`, and only that POST verifies.
4. The device polls `POST /auth/poll {requestId, pollSecret}`:
   - `202 {status:'pending'}` until verified.
   - `200 {refreshToken, accessToken, accessExpiresAt, deviceId}` exactly once. This creates the device session.
   - `410` after that, or when the link expired. `404` for an unknown request or a wrong `pollSecret`.
5. Links expire after 15 minutes (`LINK_TTL_SECONDS`) and work once.
6. Rate limits, counted per 15 minutes: 5 starts per email and 20 per IP (`CF-Connecting-IP`). Over the limit gives `429` with `Retry-After`. The count includes non-owner starts, so the limit does not reveal the owner either.

### Tokens

- Access token: HS256 JWT signed with `JWT_SECRET`. Claims: `sub` = `owner`, `dev` = device id, `iat`, `exp` (15 minutes). Verified with WebCrypto `subtle.verify` (constant time). `alg` other than `HS256` is rejected, including `none`.
- Refresh token: opaque, 32 random bytes. `POST /auth/refresh {refreshToken}` rotates it and returns a new access token. The old token stops working at once.
- Reuse: presenting a retired refresh token revokes that device, since the token was probably stolen. Its sockets are closed, and the device loses access immediately.
- Every bearer request also checks that the device is not revoked. Revocation therefore takes effect on the next request, not at token expiry.

### Device management

- `GET /devices` (bearer): `[{id, name, createdAt, lastSeenAt, current}]`.
- `DELETE /devices/:id` (bearer): revokes that device and closes its WebSockets with code `4001`. Unknown id is `404`.
- `POST /auth/signout-all` (bearer): revokes every device.

## Sync protocol

Endpoint: `GET /sync` with a WebSocket upgrade. Send the access token in
`Sec-WebSocket-Protocol: prometheus-sync, bearer.<token>` (preferred), or as `?access_token=` as a fallback.
The server replies with the subprotocol `prometheus-sync`. The token is never echoed back.

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
| `EMAIL_PROVIDER` | var | `resend` or `cloudflare`. |
| `EMAIL_FROM` | var | Sender on a verified domain. |
| `CF_ACCOUNT_ID` | var | Only for `EMAIL_PROVIDER = "cloudflare"`. |
| `JWT_SECRET` | secret | Signs access tokens. 64 random hex characters (at least 32). The Worker refuses to run (500, `config_missing`) while any setting still holds its placeholder value or `JWT_SECRET` is shorter than 32 characters. |
| `EMAIL_API_KEY` | secret | Email provider API key. |
| `LINK_TTL_SECONDS`, `COMPACT_AT`, `COMPACT_KEEP` | optional var | Defaults 900, 10000, 2000. |

Secrets never go in `wrangler.toml` or in the repo.

## Email

`src/email.ts` sends the magic link through the provider named by `EMAIL_PROVIDER`:

- `resend`: `POST https://api.resend.com/emails`, bearer `EMAIL_API_KEY`.
- `cloudflare`: `POST https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/email/sending/send`, bearer `EMAIL_API_KEY`. **Confirm this endpoint and its payload against the current Cloudflare Email Sending docs before the first deploy.** Only the Resend path is exercised by tests.

A failed send still returns `200` to the client, so the reply stays uniform. The failure is logged with its HTTP status only. Neither the token nor the link is logged.

## Security notes

- Only hashes of tokens and poll secrets are stored. Refresh tokens are stored as hashes too.
- The owner's data is readable by the server. This is the trade-off accepted in [`design/OS-359-multi-user-sync.md`](./design/OS-359-multi-user-sync.md). Folder sync stays ciphertext-only.
- The verify page uses a strict CSP, `no-referrer`, and escapes every value.
- Errors are logged by message only. No tokens, links or secrets reach logs.
- The `?access_token=` fallback can end up in access logs. Clients should prefer the protocol header.
- Tests need no backdoor. The email API is stubbed at the outbound fetch level (Miniflare `outboundService`).

## Local development

```sh
cd server
npm install
cp .dev.vars.example .dev.vars   # then edit: JWT_SECRET and EMAIL_API_KEY values
npx wrangler dev
```

`npx wrangler dev` runs the Worker locally. With the placeholder `OWNER_EMAIL` and no real email key, a sign-in email cannot be delivered. For local testing, read the link from the test harness instead.

## Testing

```sh
cd server
npm ci
npm test         # builds dist/worker.js, then runs test/*.test.mjs with node:test and Miniflare
npm run typecheck
```

- `test/auth.test.mjs`: health, missing config, emails, verify and poll, expiry, reuse, rate limits, JWT rejection, refresh rotation, devices, signout-all.
- `test/sync.test.mjs`: upgrade auth, catch-up, push ack and broadcast, skew, invalid ops, idempotent pushes, ordering, compaction and snapshot catch-up, socket close on revoke, and a load check (3 sockets, 1,000 ops).

CI runs the same tests in the `server` job of `.github/workflows/ci.yml`. CI never deploys.

## Deploying (Ashden, later)

Nothing is deployed yet. These steps are for later, on Ashden's machine.

1. Create a Cloudflare account. Note the account id from the dashboard. Enable the Workers plan that supports Durable Objects with SQLite.
2. Choose a `workers.dev` subdomain in the dashboard (free).
3. Log in from the server directory: `cd server && npx wrangler login`. This is interactive and runs on Ashden's machine only.
4. Edit `server/wrangler.toml`. Replace `you@example.com`, `REPLACE_WITH_SUBDOMAIN`, `REPLACE_WITH_VERIFIED_DOMAIN` and, if using Cloudflare Email Sending, `CF_ACCOUNT_ID`.
5. Verify the sender domain with the email provider (add its SPF and DKIM records on a domain you control). Do this before the first sign-in.
6. Set the secrets. Each command prompts for the value:
   ```sh
   npx wrangler secret put JWT_SECRET       # 64 random hex characters
   npx wrangler secret put EMAIL_API_KEY    # the provider's API key
   ```
7. Deploy: `npx wrangler deploy`. Then check `https://prometheus-sync.REPLACE_WITH_SUBDOMAIN.workers.dev/health` returns `{"ok":true}`.
8. Optional, GitHub Actions deploys: create an API token in the Cloudflare dashboard from the "Edit Cloudflare Workers" template, scoped to this account. Store it as the repo secret `CLOUDFLARE_API_TOKEN`, and store the account id as `CLOUDFLARE_ACCOUNT_ID`. The workflow `.github/workflows/deploy-sync-server.yml` runs only from the Actions tab (`workflow_dispatch`). It runs the tests, then `npx wrangler deploy`.

Never paste the token or secrets into the repo, into issues, or into chat.
