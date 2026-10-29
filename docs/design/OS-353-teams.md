# OS-353 Teams with membership (design note)

Status: design for review. No code yet. Issue: OS-353. Size: L (about 3 to 4 days).

## Problem
Today a project is the team. It owns the issue key (`Project.key`), the issue number sequence, the workflow statuses, the cycles and `members: string[]`. Two projects cannot share a key, a workflow or a cycle.

## Scope
First slice:
- A `Team` entity inside a space. It owns the key, the issue number sequence, the workflow statuses, the cycle settings and the members (a list of people's names, as now).
- Each project belongs to one primary team, and may list other teams for visibility.
- Issue keys and numbers come from the team, so issues from two projects in one team share one sequence (for example ENG-1 to ENG-n).
- Migration: one team per existing project, so every key and number stays the same.
- A Teams section in space settings: create, rename, change the key (with a warning), and edit members and statuses.

Deferred:
- Team-level labels (labels stay at space and project level for now).
- Moving issues between teams with renumbering. Moving would keep the old key as an alias.
- Team pages, team dashboards and per-team triage.

## Data model and migration
```
Team { id, spaceId, name, key, color, members: string[], statuses: StatusDef[],
       nextNumber: number, cycleLength, autoCycles, autoRollOver? }
Project { ...; teamId: string; teamIds?: string[] }   // key/statuses/cycle settings read from the team
Cycle { ...; teamId?: string }                          // cycles move from project to team
```
- `AppData.teams: Team[]` is added, and `version` goes from 4 to 5. This is a real schema bump, because keys and statuses move.
- `migrate.ts`: for each project, create `team-<projectId>` copying `key`, `statuses`, `members` and cycle settings, and set `nextNumber = max(issue.number) + 1`. Then set `project.teamId` and `cycle.teamId`. The old project fields stay in place, read-only, for one release so a downgrade still opens the file.
- Issue numbers are given out from `team.nextNumber`. The existing per-project uniqueness check becomes per team.

## Local-first and sync
- `Team` is a new synced row type. It uses the same field-level HLC ops as projects (`create`, `set`, `del`).
- Concurrent issue creation on two devices can hand out the same number. This is already possible today with projects. The fix is the same: when a number clash is seen on merge, the later HLC is renumbered to `nextNumber` and the old key is recorded in activity. A test covers it.
- A device on the old version that receives `team` ops ignores the unknown row type. It keeps working on its own copy, but should be upgraded before editing.

## UI touchpoints
Space settings (a Teams tab), project settings (a team picker instead of the key, statuses and cycle fields), sidebar grouping (optional: group projects by team), the issue key display, the command menu ("Go to team"), and the Cycles view (filter by team).

## Security
No secrets. Members stay plain names until OS-359 brings accounts.

## Accounts or tokens Ashden needs
None.

## Test plan
- Unit: the migration (one team per project, keys and numbers unchanged, cycles re-parented), number allocation across two projects in one team, and the renumber-on-clash merge.
- `npm run test:sync`: a team row syncs between two devices, and the number clash resolves the same way on both.
- Smoke (xvfb): create a team, move two projects into it, create issues and check the shared sequence. Screenshot.

## Open questions for Ashden
1. Should a project belong to exactly one team (simpler, like Linear), or to several (the issue asks for "one or more")? My proposal is one primary team plus optional extra teams for visibility only.
2. When two projects merge into one team, should their issues keep their old keys (as aliases) or be renumbered?
3. Do statuses move entirely to the team, or can a project still override them?

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
