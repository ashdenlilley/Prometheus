# OS-358 Third-party integrations framework (design note)

Status: design for review. No code yet. Issue: OS-358. Size: XL overall. The first slice is about M (3 days).

## Scope
First slice:
- An integration framework: a registry of providers, a shared credential store, and a shared outgoing-HTTP queue (reusing the OS-356 delivery queue).
- First integration: Slack via an incoming webhook, as an automation action ("Post to Slack") and a manual "Share to Slack" on an issue. The message uses Block Kit, with the title, key, status and assignee. A clickable `prometheus://` deep link would need a protocol handler, which the app doesn't register yet; that's an open question. No backend or OAuth is needed.
- An Integrations column: a cell holding links to external items (URL plus provider, title and icon), auto-detected for Slack, Figma, Sentry, Zendesk, Jira, Google and Teams URLs. In this slice it only stores and displays links, with no API calls.
- Follow-up issues, one per remaining provider.

Deferred (one follow-up each):
- Microsoft Teams: post through a Teams Workflows webhook URL, the same shape as Slack.
- Sentry: show the issue title and status for linked Sentry URLs.
- Figma: thumbnails for linked frames.
- Zendesk: show ticket status, and create an issue from a ticket.
- Jira: live two-way sync (the one-off file import is done in OS-352).
- Gmail: create an issue from an email. This needs OAuth with a Google Cloud project, and the hardest review.

## OAuth versus tokens for a desktop app
- Prefer webhooks and personal tokens: no client secret ships in the app, there's nothing to host, and the scopes are easy to understand.
- OAuth only where a provider offers nothing else (Gmail), using PKCE with a loopback redirect (`http://127.0.0.1:<random port>/callback`), as RFC 8252 recommends. No client secret is embedded.

## Sync model
- Credentials are per device and never synced.
- Integration settings (which channel, which events) sync.
- Outgoing posts fire only from the device that made the change, as with OS-356.
- Link metadata (titles, status) is cached in the row and refreshed by whichever device has a token.

## Data model
```
Integration { id, provider: 'slack' | ..., name, scope: 'space' | 'project', scopeId, settings: {...} }  // AppData.integrations?
Column.type 'integrations' → value: { url, provider, title?, status? }[]
Automation action { type: 'post_slack'; integrationId; template? }
```
Optional fields only, so there is no schema bump.

## UI touchpoints
Settings > Integrations (add Slack, paste the webhook URL, send a test message), the "Post to Slack" automation action, "Share to Slack" in the issue menu, and the Integrations column cell.

## Security
- A Slack incoming-webhook URL is a secret, because anyone holding it can post. It is stored with `safeStorage` and masked in the UI. It is never synced, logged or committed.
- The outgoing URL policy is limited to `hooks.slack.com` for Slack.
- Message text is escaped for Slack mrkdwn so issue content cannot inject mentions such as `<!channel>`.

## Accounts or tokens Ashden needs
- First slice: a Slack incoming-webhook URL. In Slack, create an app at api.slack.com/apps, enable Incoming Webhooks, which grants the `incoming-webhook` scope, and add it to one channel. The URL is pasted into Prometheus, not into the repo.
- Later, for each follow-up:
  - Teams: a Workflows webhook URL for a channel.
  - Sentry: an auth token with `project:read` and `event:read`.
  - Figma: a personal access token with `file_content:read` (scope names to be confirmed at setup).
  - Zendesk: the subdomain, an agent email and an API token.
  - Jira Cloud: an Atlassian API token plus the account email and site URL.
  - Gmail: a Google Cloud OAuth client (Desktop type) with `gmail.readonly`, plus the consent-screen setup.

## Test plan
- Unit: the Slack payload builder (escaping, Block Kit shape), URL detection for each provider, the automation action, and the policy rejecting non-Slack URLs.
- Integration: a local receiver standing in for Slack, to test retries on 429 with `Retry-After`.
- Manual: one real post to a test channel.

## Open questions for Ashden
1. Is Slack the right first integration, or would Teams or Sentry be more useful to you?
2. Which of the six follow-ups do you actually want? I'd close the rest as won't-do for now.
3. Should Prometheus register a `prometheus://` protocol handler so Slack messages can link back into the app?
4. Is a channel-only Slack integration (no slash commands or unfurling, which would need a backend) acceptable?

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
