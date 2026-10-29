# OS-356 Outgoing webhooks and a local REST API (design note)

Status: design for review. No code yet. Issue: OS-356. Size: M (about 3 days).

## Scope
First slice:
- Outgoing webhooks per project, each with a URL, a list of events, a secret, and an on/off switch.
- Deliveries are signed, retried with backoff, and recorded in a delivery log with a "Redeliver" button.
- A REST API on the existing local server (127.0.0.1, the same port as MCP) under `/api/v1`, covering the core MCP operations.

Deferred:
- Incoming webhooks (they need a public URL, so a backend or tunnel).
- Webhooks for docs, cycles and projects (issues and comments come first).
- OpenAPI UI. A static `docs/api.md` ships instead.

## Events and payload
Events: `issue.created`, `issue.updated` (with changed fields), `issue.deleted`, `issue.status_changed`, `comment.created`.
```
POST <url>
Content-Type: application/json
Prometheus-Event: issue.updated
Prometheus-Delivery: <uuid>
Prometheus-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>
{ "event": "issue.updated", "at": "...", "actor": "me|agent:<id>|sync:<device>",
  "project": { "id", "key" }, "issue": { ...full issue }, "changes": { "status": ["todo","done"] } }
```
- Signing follows the common Stripe/GitHub style (timestamped HMAC), so receivers can reject replays older than 5 minutes.
- Events come from the same diff the audit log and sync use (`diffOps`). Only changes made on this device fire webhooks; changes arriving through sync do not, so two devices never deliver the same event twice.

## Delivery
- A queue in SQLite (`webhook_deliveries`), processed in the main process.
- Timeout of 10 s. Retries at 1 min, 5 min, 30 min, 2 h and 6 h, then marked failed.
- 2xx means delivered. 410 disables the webhook. The log keeps the last 500 deliveries per webhook.
- Only `https://` URLs are allowed, plus `http://localhost` for testing. Requests to private network ranges are refused unless "allow local network" is ticked.
- If the app is closed, pending deliveries resume on the next launch. This is a known limit of a desktop app.

## REST API
- Endpoints: `GET /api/v1/projects`, `GET /api/v1/issues?project=&status=&assignee=&q=`, `GET/PATCH/DELETE /api/v1/issues/:key`, `POST /api/v1/issues`, `POST /api/v1/issues/:key/comments`.
- Each handler calls the same functions the MCP tools use (they are moved from `mcp.ts` into a shared `api/ops.ts`), so there is one implementation with two front doors.
- Auth: `Authorization: Bearer <token>` with the MCP token or an agent token (OS-355), localhost only, with the same Host-header check as MCP.
- Errors are JSON `{ error: { code, message } }` with proper status codes.

## Local-first and sync
- Webhook configs sync (so they show on every device), but secrets are per device and deliveries only fire from the device where the change was made.

## UI touchpoints
Project settings > Webhooks (add, edit, test-send, delivery log, redeliver) and Settings > API (the base URL, copy the token, and an example `curl`).

## Security
- Webhook secrets are 32 random bytes, stored with `safeStorage`, never in the synced data or the repo. They are shown once, with a "rotate" action.
- The REST server stays on 127.0.0.1 and keeps the Host and Origin checks, which block DNS-rebinding and browser cross-site calls.
- Payloads include issue content, so the settings screen warns that data leaves the device.

## Accounts or tokens Ashden needs
None to build it. To try it, any receiver works (for example a local `nc` or a free request-inspector service). No account is needed.

## Test plan
- Unit: the signature (a known vector), the backoff schedule, the 410 and timeout handling, event generation from `diffOps` (sync-originated changes excluded), the URL policy, and each REST handler, including auth failures.
- Integration: a local HTTP receiver checks the signature and a retry after a 500.

## Open questions for Ashden
1. Is "fires only on the device that made the change" acceptable? The alternative is a nominated "webhook device".
2. Should the REST API allow deletes, or be create, read and update only, with deletes left to the UI?
3. Are issue and comment events enough to start, or do you need project or cycle events too?

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
