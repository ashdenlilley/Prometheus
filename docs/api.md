# Prometheus local API

Prometheus runs a local server on `127.0.0.1` while the app is open. The same port serves the MCP endpoint (`/mcp`) and the REST API (`/api/v1`). The port defaults to 7878 and moves to the next free port if it is taken. Copy the current URL and token from Settings.

```
Base URL: http://127.0.0.1:7878/api/v1
Token:    the shared MCP token from Settings (regenerating it stops the old one). Per-agent tokens from Settings > Agents work on `/mcp` only.
```

## Authentication and headers

Every request needs the token as a bearer token:

```
Authorization: Bearer <token>
```

Requests must use a `Host` of `127.0.0.1` or `localhost`, and any `Origin` header must also be local. Other values are refused with 403, which blocks DNS rebinding and cross-site browser requests. Requests send and receive JSON (`Content-Type: application/json`). Bodies are limited to 1 MB.

## Errors

Every error response has this shape:

```json
{ "error": { "code": "not_found", "message": "Issue not found. Pass a valid id or key such as PRM-12." } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `invalid_json` | The body is not valid JSON |
| 400 | `invalid_request` | The body is not a JSON object, or a field fails validation (for example a bad status or a missing title) |
| 401 | `unauthorized` | No token, or a wrong token |
| 403 | (none) | Host or Origin is not local |
| 404 | `not_found` | Unknown route, unknown issue or project key |
| 405 | `method_not_allowed` | Method not supported on this path. DELETE is not supported on any path |
| 413 | `payload_too_large` | Body over 1 MB |
| 503 | `not_ready` | Prometheus has not finished loading its data |

## Endpoints

Issue objects use the same shape as the MCP `get_issue` tool. They include `id`, `key` (such as `PRM-12`), `title`, `description`, `status`, `priority` (0 none to 4 low), `assignee`, `labels`, `estimate`, `parentId`, `milestoneId`, `triage`, `archivedAt`, `cycleId`, `startDate`, `dueDate`, `values`, `relations`, `comments` (a count), `category` and `updatedAt`.

Statuses are project-specific. The `status` values are the status ids the project defines, such as `backlog`, `todo`, `in_progress` or `done`. An unknown status is rejected with 400.

### List projects

```bash
curl -s http://127.0.0.1:7878/api/v1/projects \
  -H "Authorization: Bearer $TOKEN"
```

Returns `id`, `key`, `name`, `spaceId`, `status`, `issues` and `done`.

### List issues

Query parameters are optional and combine with AND. Archived issues are left out, as in MCP.

| Parameter | Meaning |
| --- | --- |
| `project` | Project key (`PRM`) or id |
| `status` | Status id, such as `in_progress` |
| `assignee` | Assignee name, matched case-insensitively |
| `q` | Text to match in the title or labels |

```bash
curl -s "http://127.0.0.1:7878/api/v1/issues?project=PRM&status=todo&assignee=Sam" \
  -H "Authorization: Bearer $TOKEN"
```

There is no paging. Every match is returned.

### Get one issue

```bash
curl -s http://127.0.0.1:7878/api/v1/issues/PRM-12 \
  -H "Authorization: Bearer $TOKEN"
```

### Create an issue

Body fields: `projectId` (required, key or id), `title` (required), and optionally `description`, `status`, `priority`, `assignee`, `labels`, `estimate`, `startDate`, `dueDate`, `cycleId`, `milestoneId`, `parentKey` and `triage`. Returns 201 with the issue.

```bash
curl -s -X POST http://127.0.0.1:7878/api/v1/issues \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId": "PRM", "title": "Login fails on Safari", "priority": 2, "labels": ["auth"]}'
```

### Update an issue

`PATCH` changes only the fields you send. An empty string clears a date, cycle, milestone or parent. Returns 200 with the updated issue.

```bash
curl -s -X PATCH http://127.0.0.1:7878/api/v1/issues/PRM-12 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'
```

### Add a comment

Body: `body` (required), and optionally `author`. Mentions like `@name` notify that person in the app. Returns 201.

```bash
curl -s -X POST http://127.0.0.1:7878/api/v1/issues/PRM-12/comments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body": "Reproduced in staging", "author": "Ashden"}'
```

### Not available

Deleting issues is not available over the API. Use the app. `DELETE` on any path returns 405.

## Webhooks

Webhooks belong to a project. Each one has a URL, a list of events, an enabled flag and a signing secret. The secret is shown once when the webhook is created and can be rotated. Secrets stay on the device where they were created. Changes made on another device do not send from this one.

Note: the settings screen for webhooks is not in this release. The delivery engine, signing and the URL policy are in place, and the webhook config syncs with the rest of your data.

### Events

| Event | Fired when |
| --- | --- |
| `issue.created` | An issue is created |
| `issue.updated` | An issue field changes. `changes` lists each field as `[old, new]` |
| `issue.deleted` | An issue is deleted |
| `issue.status_changed` | The status changes. Also fires `issue.updated` |
| `comment.created` | A comment is added. `comment` holds it |

Only changes made in this app fire webhooks: the UI, and the REST and MCP APIs. Changes that arrive through sync do not.

### Request

```
POST <url>
Content-Type: application/json
Prometheus-Event: issue.updated
Prometheus-Delivery: 5b0e8c1e-...        (unique per delivery; use it to de-duplicate)
Prometheus-Signature: t=1761782400,v1=<hex>
```

Body:

```json
{
  "event": "issue.updated",
  "at": "2026-10-30T01:02:03.000Z",
  "actor": "me",
  "project": { "id": "...", "key": "PRM" },
  "issue": { "id": "...", "key": "PRM-12", "title": "...", "status": "done" },
  "changes": { "status": ["in_progress", "done"] }
}
```

`actor` is `me` for changes made in the app, or `mcp` for changes made through MCP or REST. `issue` holds the full issue as it is after the change. For `issue.deleted` it holds the issue as it was before. `comment` is present on `comment.created`. Test sends have `"test": true`.

Any 2xx response counts as delivered. A `410 Gone` response disables the webhook, with a reason shown in the app. Any other response, a timeout (10 seconds) or a network error is retried.

### Retries

After a failed attempt, Prometheus waits and tries again:

| Attempt | Wait before it |
| --- | --- |
| 2nd | 1 minute |
| 3rd | 5 minutes |
| 4th | 30 minutes |
| 5th | 2 hours |
| 6th | 6 hours |

After the sixth attempt the delivery is marked failed. The app keeps the last 500 deliveries per webhook. A logged delivery can be re-sent as a new delivery with the same body.

The queue lives in the app. Deliveries that are waiting resume the next time Prometheus is open, so a receiver that is down while the app is closed gets nothing until then.

### Verifying the signature

The signature is an HMAC-SHA256 over `<t>.<raw body>`, using the webhook secret. Verify against the raw body bytes, not re-serialised JSON. Reject a timestamp more than 5 minutes from your clock to block replays.

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyPrometheus(secret, header, rawBody, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')))
  if (!parts.t || !parts.v1) return false
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSec) return false
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest()
  const given = Buffer.from(parts.v1, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}
```

In an Express-style receiver, use the raw body parser for this route so the bytes match.

### URL policy

- `https://` URLs are allowed.
- `http://` is allowed only for `localhost`, `127.0.0.1` and `[::1]`, and only when the webhook's `allowLocal` flag is set.
- Private and loopback addresses are refused unless `allowLocal` is set. That covers `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, `fc00::/7` and `fe80::/10`, plus the name `localhost`. Only literal addresses are checked; names are not resolved.

Payloads contain issue content and leave your device when a webhook fires. Only add URLs you trust.
