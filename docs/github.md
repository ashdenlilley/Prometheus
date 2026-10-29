# GitHub pull requests

Prometheus can link pull requests to issues, show their state, and copy a branch name for an issue. It reads from GitHub; it never writes to it.

## Create the token

1. Open [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new), or use the button in Settings > GitHub.
2. **Token name**: anything, for example `Prometheus`.
3. **Expiration**: 90 days is suggested. Create a new token when it expires.
4. **Resource owner**: the account or organisation that owns the repos you want to link. An organisation may need an owner to approve the token.
5. **Repository access**: choose **Only select repositories**, then select only the repos you will link in Prometheus.
6. **Permissions** > **Repository permissions**: set **Pull requests** to **Read-only**. **Metadata: Read-only** is added automatically and is required.
7. Set no other permissions. Create the token and copy it. GitHub shows it once.

## Paste the token

Open **Settings** (the gear icon), find the **GitHub** section, paste the token into **Personal access token**, and choose **Save**. Prometheus checks the token with GitHub before saving it, and shows `Connected as <login>` with the last four characters. **Test** checks the saved token again. **Remove token** deletes it from this device.

Link repos per project: open the project's settings, choose the **Git** tab, and enter `owner/name` or a GitHub URL. A repo can be linked once per project.

## What is polled

Each device with a token polls the repos linked to its projects. One device with a token is enough: other devices see the links through sync.

For each linked repo, Prometheus calls:

```
GET https://api.github.com/repos/{owner}/{name}/pulls?state=all&sort=updated&direction=desc&per_page=50
```

- It pages back only while a page is newer than the last poll, up to 5 pages.
- It sends `If-None-Match` with the last ETag. A `304 Not Modified` reply costs nothing against the rate limit.
- The default interval is 2 minutes. Settings > GitHub > **Check every (minutes)** takes 1 to 15. **Refresh now** polls at once, and the issue panel's **Refresh** does the same.

From each pull request Prometheus keeps the number, title, URL, state (open, draft, merged or closed), branch name and last-updated time. The body is read in memory to find issue keys and is not stored.

## Rate limits

An authenticated token gets 5,000 requests an hour. Prometheus backs off until the reset time when fewer than 10% of requests remain, and when GitHub returns 403 or 429 with no quota left. Settings > GitHub shows the pause.

A rejected token (401) stops polling on this device. Save a new token to resume.

Ten repos polled every 2 minutes is about 300 requests an hour, well inside the limit, and most of those are `304` replies.

## Matching rules

A pull request is linked to an issue when the issue's key appears in the PR's **branch name, title or body**.

- The match is case-insensitive and must be a whole word: `OS-12` matches `os-12-fix`, `[OS-12]` and `Fixes OS-12`.
- `OS-123` does not match `OS-1234` or `XOS-123`.
- Only issues in the project that owns the repo are matched, using that project's key (the team key).
- One issue can have several PRs. The issue shows one summary state, chosen in this order: open, draft, merged, closed.
- A draft PR never reads as merged.

## Branch names

The **Copy branch name** button in the issue panel copies a name in the form `os-12-short-title`: lower case, ASCII, at most 60 characters. Shortcut: **Mod+Shift+.** while the issue drawer is open and you are not typing.

If Settings > GitHub > **Branch prefix** is set, the name becomes `prefix/os-12-short-title`, for example `ashdenlilley/os-12-short-title`.

## Automations

Project settings > **Git** has two optional moves, both off by default:

- **When a PR opens (not draft), move to** a status.
- **When a PR merges, move to** a status.

Each move happens once per PR and state. Moving the issue back by hand is kept; Prometheus does not move it again for the same PR and state. Turning an automation on applies to PRs that are already open or merged. Each move is written to the issue's activity as `Moved by PR <url>`, and each new link and state change is logged too.

## Privacy

- **Where the token is kept**: the main process seals it with Electron `safeStorage`, which uses the macOS Keychain or Windows DPAPI, in the app's data folder. The renderer never receives it; it sees only the last four characters.
- **Where it is sent**: only to `api.github.com`, over HTTPS, with a `Bearer` header. Prometheus refuses to call any other host.
- **Without a keychain**: if the OS keychain is unavailable (including Linux with no keyring, where Electron would fall back to a fixed key), Prometheus refuses to save the token and says so. It is never written in plain text.
- **Sync**: the token is never synced, logged or written to the repo. The linked repos, PR links and their states do sync, like other issue data, so other devices see them without a token. Poll interval and branch prefix are per device.
- **Scope**: the token can read pull requests in the repos you selected and nothing else. It cannot write to GitHub.

## Not included yet

GitLab, CI or check status, creating branches or PRs from Prometheus, and commits without a PR. See [feature-parity.md](feature-parity.md).
