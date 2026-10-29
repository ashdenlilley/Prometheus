# OS-357 Git integration: branch names and PR status (design note)

Status: design for review. No code yet. Issue: OS-357. Size: L. The first slice is about M (3 days).

## Scope
First slice (GitHub):
- "Copy branch name" on an issue (a menu item and a shortcut), giving `os-123-short-title-slug`: lower case, ASCII, at most 60 characters. An optional `<user>/` prefix is a setting.
- Repos are linked per project (`owner/name`, several allowed).
- Linked PRs appear on the issue panel with their state (open, draft, merged, closed), title and a link, plus a PR column and filter chip.
- A PR is matched to an issue when its branch name, title or body contains the issue key (`OS-123`, case-insensitive, on a word boundary). "Fixes OS-123" is matched too.
- Optional automations per project: PR opened (not draft) moves the issue to In Review, and PR merged moves it to Done. Both are off by default, and each move is logged with the PR link.

Deferred to a follow-up issue:
- GitLab (same design, using the `read_api` scope).
- CI/check status.
- Creating branches or PRs from Prometheus.
- Commits linked without a PR.

## Poll, not webhooks
A desktop app has no public URL, so webhooks would need a backend (OS-359) or a tunnel. Polling is used instead:
- Every 2 minutes while the app is open (configurable to 1 to 15), plus on demand with "Refresh".
- Per repo: `GET /repos/{owner}/{repo}/pulls?state=all&sort=updated&direction=desc&per_page=50` with `If-None-Match` (ETag). It pages back only until it reaches PRs older than the last poll.
- Rate limit: an authenticated token gets 5,000 requests an hour. Ten repos at one request every 2 minutes is about 300 an hour, and 304 Not Modified replies to conditional requests don't count against the limit. Polling backs off when `x-ratelimit-remaining` falls under 10%.

## Data model and migration
```
Project.repos?: { provider: 'github'; owner: string; name: string }[]
Project.gitAutomation?: { onOpen?: string /*status id*/; onMerge?: string }
GitLink { id, issueId, provider, repo, number, title, url, state, draft, branch, updatedAt }   // AppData.gitLinks?
```
All fields are optional, so there is no schema bump. Links sync like other rows. Only one device needs a token, and other devices see the synced links.

## Local-first and sync
- Each device with a token polls. Status-change automations are idempotent (keyed `git:<repo>#<n>:<state>` in `firedAutomations`), so two polling devices don't double-move an issue.

## UI touchpoints
Issue panel (a "Copy branch name" button and a Pull requests section), project settings > Git (repos, automations, the poll interval), Settings > Accounts (the GitHub token), a PR column, and a filter.

## Security
- The token is stored with Electron `safeStorage` (Keychain or DPAPI), never in synced data, logs or the repo. It is masked in the UI, with a "Test" button.
- The token is only sent to `api.github.com`. Requests go through the main process; the renderer never sees the token.

## Accounts or tokens Ashden needs
- A GitHub fine-grained personal access token, limited to the selected repositories (for example `ashdenlilley/Prometheus`). Permissions: Pull requests: Read-only and Metadata: Read-only, which is added automatically. No write scopes. A 90-day expiry is suggested.
- Later, for GitLab: a GitLab personal access token with the `read_api` scope, and the instance URL if self-hosted.

## Test plan
- Unit: branch-name generation (unicode, length, stop characters), key matching (branch, title, body, no false matches like `XOS-1234`), the state-to-status automation, and idempotency.
- Integration: a mocked GitHub API (fixture JSON, an ETag 304 path, a rate-limit reply).
- Manual: one real read-only token against this repo before release.

## Open questions for Ashden
1. GitHub only for the first slice, with GitLab as a follow-up? Do you use GitLab at all?
2. Should the automations default to on or off? I propose off.
3. Branch format: `os-123-slug`, or `ashdenlilley/os-123-slug` like Linear?

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
