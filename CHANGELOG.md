# Changelog

All notable changes to Prometheus are documented here.

## [0.3.0] - 2026-10-30

### Highlights
- **Cloud sync** with email magic-link sign-in, confirmed on the device with a 6-digit code (#56, #61).
- **Multi-user roles and permissions**, including per-column rules by role (#57, #58).
- **Teams** with membership (#50) and **Markdown documents** (#51).
- **Agents** as an assignee type (#52).
- **Outgoing webhooks and a local REST API** (#53).
- **GitHub integration** (branch names and PR status) and **Slack** webhooks (#54, #55).

### Added
- Board swimlanes grouped by any field (#10); undo/redo for edits, bulk edits, deletes and CSV import (#9).
- Show-completed toggle for List, Board and Table (#20); drawer shortcuts `l` for labels and `a` for assignee (#21).
- Cycles: automatic roll-over, burndown scope line, created vs completed chart (#22); recurring issues (#23).
- New field types: computed progress, t-shirt estimates, date with time (#24).
- Pie and line charts and favourite saved views (#25).
- Auto-close and auto-archive (#27); automations that create across projects, recipes and more triggers (#28).
- Subscriptions, comment attachments and reactions (#29).
- Table: per-view layout, timers, Excel import/export (#30).
- Shared labels with groups and project templates (#31); dashboard calendar and portfolio widgets, and an activity view (#32).
- Button, Subtasks and per-person votes columns (#35); Workload and sprint Planning views (#36).
- Files gallery and offline Map views (#37); project folders and personal views (#38).
- Local intake forms and Jira/Asana file import (#39); append-only audit log (#40).
- Slack notifications via webhooks and a links column (#55).

### Changed
- Upgraded to Electron 45.1.0; macOS 13 or later is now required (#12, #13).
- On macOS, Cmd+Z / Shift+Cmd+Z now drive the app's own undo/redo (#11).
- Archived issues are hidden everywhere (#34).
- Node 22 pinned for development; CI, tests and dependency updates (#1, #2, #4, #6, #8, #65).
- Documentation and feature-parity refresh (#3, #26, #33, #41–#49); sync server configuration (#59).

### Security
Hardening of cloud sign-in and sync (OS-466):
- Sign-in emails are rate-limited and capped (#60).
- **Sign-in now requires the 6-digit code shown in the app.** Clicking the email link alone is no longer enough, so older builds can't complete a cloud sign-in — update to 0.3.0 (#61).
- Live-sync connections use single-use tickets (#62).
- Limits on authentication requests, and requests from non-members are rejected (#63).
- Limits on workspace operations and push quotas (#64).
- Patched server dependencies (#65).
- Shorter token lifetimes, stricter token checks, a locked email sender, and removal of an older login method (#66).

### Fixed
- CSV export: custom column values no longer double-quoted (#5); values with a lone carriage return are quoted (#14).
- Opening older (pre-v4) files: no crash on an empty spaces list (#15) and legacy top-level fields are kept (#17).
- Built-in MCP server: rejects invalid or empty requests correctly (#7, #16), `update_issue` returns the updated issue (#18), `update_project` rejects an invalid status (#19).
- Recurring issues get stable ids (#27); trigger values reset when their type changes (#34).
