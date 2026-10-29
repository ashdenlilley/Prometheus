# Integrations

Status: Slack, with the backend and UI built. Design: [design/OS-358-integrations.md](design/OS-358-integrations.md).

## UI

- **Settings > Integrations** (`IntegrationsSettings.tsx`): add a Slack integration (name, scope, optional channel label, webhook URL). Each row shows whether this device has a webhook, sends a test message, replaces or removes the webhook, or deletes the integration. Adding saves the integration first, then sets the URL. If the URL is refused, the integration is removed again.
- **Automations** (project settings): "Post to Slack" picks an integration in scope, with an optional message template. Not offered for object or cycle triggers.
- **Issue drawer**: the actions menu has "Share to Slack". With several integrations in scope, it lists one item per integration. With none, the item is disabled.
- **Integrations column** (`integrations` type): paste a link to add it, and remove it with ×. Table cells show read-only chips. CSV and XLSX export the URLs.
- Provider icons are letter badges (`ProviderBadge.tsx`), with no remote images. Labels and pure helpers are in `src/shared/integrations.ts`.

## Slack setup (incoming webhook)

1. Create an app at https://api.slack.com/apps (From scratch).
2. Enable **Incoming Webhooks**, then **Add New Webhook to Workspace** and pick one channel.
3. Copy the URL (`https://hooks.slack.com/services/...`). Paste it into Prometheus (Settings > Integrations). It is stored on this device only.

Each Slack integration in Prometheus has a name, a scope (one space or one project) and an optional channel label. The webhook URL is kept per device and per integration.

## What gets posted

- **Post to Slack** automation action on an issue trigger: queues one message each time the rule fires.
- **Share to Slack** on an issue: queues one message now.
- The message is Block Kit: a headline with the issue key and title, then a context line with status, priority, assignee, project and the reason (the automation name, or "Shared").
- Automation templates can use `{key}`, `{title}`, `{status}`, `{assignee}` and `{project}`. Values are escaped, so issue text cannot ping `@channel` or `@here`.

Posts go out only from the device that made the change. Changes that arrive by sync never post, because pending posts are never stored or synced.

## Security

- The webhook URL is a secret: anyone holding it can post to the channel. It is sealed by the OS keychain (`safeStorage`) in `integration-secrets.json` in the app data folder. It is never written to the database, sync, audit log, notifications or logs. The UI only shows a hint: `hooks.slack.com/…abcd`.
- Setting a URL is refused when the OS keychain is not available.
- Outgoing URLs must match `https://hooks.slack.com/{services,workflows,triggers}/...`, with no userinfo and no port. Other hosts are refused before any request.
- Redirects are errors. Requests time out after 10 seconds.
- Escaping: `&`, `<` and `>` are escaped in every field, so `<!channel>`, `<@U123>` and `<http://...|...>` are inert.
- Failures show as a notification with the integration name and Slack's error text. The URL is never included.

### Test-only environment variables

These exist for the automated tests and a local smoke run. Do not set them in normal use.

- `PROMETHEUS_SLACK_TEST_URL_BASE=http://127.0.0.1:<port>/`: also allows webhook URLs under this exact local base, so a local HTTP receiver can stand in for Slack. Only `127.0.0.1` bases are honoured.
- `PROMETHEUS_SLACK_ALLOW_INSECURE_TEST=1`: on Linux, treats the `basic_text` safeStorage backend (a fixed key, not a keychain) as secure, so a URL can be stored in a headless environment.

## Behaviour on failure

- 429: waits `Retry-After` seconds (default 1, capped at 60), then retries.
- 5xx and network errors: retries with 1s, 2s and 4s backoff, up to 4 attempts.
- Other 4xx (for example `channel_not_found`, `no_service`, `channel_is_archived`): not retried.
- Sends run one at a time, in the order queued, in memory. Queued messages are lost if the app quits before they go out.

## Follow-ups

From the design note, one issue each:

- Microsoft Teams: post through a Teams Workflows webhook.
- Sentry: show issue title and status for linked Sentry URLs.
- Figma: thumbnails for linked frames.
- Zendesk: ticket status, and create an issue from a ticket.
- Jira: live two-way sync.
- Gmail: create an issue from an email (OAuth, PKCE, loopback redirect).

Also open: a `prometheus://` protocol handler so Slack messages can link back into the app; a persistent outbox, so posts survive a restart (this depends on the OS-356 delivery queue).
