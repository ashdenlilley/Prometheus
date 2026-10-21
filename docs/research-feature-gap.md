# Feature gap: Prometheus vs monday dev and Linear

Scope: boards, tables, overviews, cycles, roadmaps and issues. "monday dev" is read as monday.com's product-development offering (the "MDC" in the request).

Sources (secondary and vendor pages; verify current plans on the vendor sites):
- monday dev: [monday.com/w/dev](https://monday.com/w/dev), [Unique features found only in monday dev](https://support.monday.com/hc/en-us/articles/23981188339474-Unique-features-found-only-in-monday-dev), [Sprint planning with monday Dev](https://till-freitag.com/blog/sprint-planning-monday-dev-en), [Capterra listing](https://www.capterra.com/p/10008569/monday-dev/)
- Linear: [Making the most of Linear](https://linear.app/docs/making-the-most-of-linear), [Linear review 2026](https://automationatlas.io/answers/linear-review-2026/), [Linear Review 2026](https://nubiapage.com/linear-review-2026-app-ai-login-company/)

## What the two products cover

**monday dev**
- Scrum, kanban and hybrid workflows. Typical setup is three boards per team: backlog, sprint, roadmap.
- Sprint planning and burndown/burnup reports, plus customisable real-time reports and dashboards.
- Roadmap Tracker for quarterly and yearly plans shared with stakeholders.
- Epics, tasks and bugs linked across teams. QA and release workflows.
- Integrations: GitHub, GitLab, Bitbucket, Slack, Microsoft Teams. Automation recipes (150+ listed at launch).

**Linear**
- Hierarchy: issues, projects, cycles, initiatives.
- Projects carry progress, target dates, project updates and milestones.
- Cycles are time-boxed sprints. Roadmap is a visual timeline of planned work.
- Saved custom views on issue lists. Keyboard-first command palette.
- Git and GitHub linkage; AI agent workflows that investigate issues and propose code changes.

## Prometheus today

| Area | Prometheus |
|---|---|
| Spaces and projects | Yes. Space overview with progress and stats. |
| Issues | List grouped by status, quick add, detail drawer, priority, labels, assignee, dates, custom fields. |
| Board | Kanban by status, drag between columns, quick add per column. |
| Table | Grouped by status, 17 column types, resizable and reorderable columns, sort per column, group-footer summaries, inline edit. |
| Timeline | Gantt bars, drag to resize and move, cycle bands, today marker. |
| Cycles | Create, progress, assign unassigned issues. |
| Roadmap | Project bars with progress and editable dates, scoped to the space. |
| Automation and integrations | Local MCP server for Claude Code and Codex. No other integrations. |
| Collaboration | Single local user. No comments, mentions, notifications or permissions. |

## Missing, by area

### Boards
- Group by or swimlanes by any field (assignee, priority, label, cycle). Board only groups by status.
- Filters on the board, and saved views.
- WIP limits per column.
- Ordering within a column (drag to reposition, not just change status).
- Bulk select and bulk move.

### Tables
- Group by any column, not only status.
- Filters and saved views. Hide or show columns.
- Sub-items (child rows under a parent).
- Bulk edit and multi-row selection.
- Keyboard navigation between cells, copy and paste ranges, and row reordering by drag.
- Formula and mirror columns (Monday's cross-board references).
- Column freeze beyond the name column.

### Overviews and dashboards
- Space overview has counts and progress only. Missing: charts over time, workload per assignee, overdue and due-soon lists, and activity feed.
- No project status updates (Linear's Project Updates, Monday's status summaries).
- No widget-based dashboards (Monday's core reporting).

### Cycles and roadmap
- Burndown and burnup charts for cycles (both products have them).
- Velocity across cycles, and carry-over of unfinished issues.
- Auto-created recurring cycles.
- Initiatives above projects (Linear).
- Milestones on projects and the roadmap.
- Dependencies between items on the timeline.
- Roadmap zoom levels (quarter, month, week).

### Issues
- Sub-issues with parent progress roll-up.
- Relations: blocks, blocked by, duplicates, related.
- Comments, mentions and an activity history per issue.
- Attachments and file columns.
- Templates for issues and projects.
- Command palette and keyboard shortcuts (Linear's core interaction).
- Triage or inbox for new items.
- Recurring issues and reminders.

### Automation and integrations
- Automation recipes ("when status changes to Done, set Completed date and notify").
- GitHub and GitLab linkage: branch names, PR status on issues.
- Webhooks and outbound notifications.
- CSV import and export.
- MCP is in place for local agents. Remote and OAuth-based MCP is not.

### Collaboration (out of scope for a single-user app)
- Multi-user accounts, sharing, permissions, guest access.
- Real-time sync between devices.

## Recommended order

**P0: makes the daily tool usable**
1. Command palette and keyboard shortcuts (Cmd+K, create, move status, open).
2. Filters and saved views on issues, board and table, with group-by on any field.
3. Sub-issues and relations (blocks, blocked by).
4. Comments and activity history per issue.
5. Bulk select and bulk edit on table and board.

**P1: planning and reporting**
6. Cycle burndown, velocity, and carry-over of unfinished issues.
7. Project status updates and an overview dashboard per space (overdue, due soon, workload per person).
8. Milestones on projects and dependencies on the timeline.
9. Initiatives above projects, and roadmap zoom.
10. Issue and project templates. CSV import and export.

**P2: integrations and automation**
11. Automation recipes for status and date changes.
12. GitHub linkage (branch names and PR status).
13. WIP limits on the board.

Not recommended now: multi-user, permissions, AI agents. These change the product's architecture, not just its features.
