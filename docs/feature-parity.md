# Feature parity: Prometheus vs Linear and monday.com

Scope: feature sets only. Brand, visual design, copy and icons are not copied. Builds on [research-feature-gap.md](research-feature-gap.md), which covers the same products at a higher level.

Sources: [Linear docs](https://docs.linear.app), [Making the most of Linear](https://linear.app/docs/making-the-most-of-linear), [Linear changelog](https://linear.app/changelog), [monday.com column types](https://support.monday.com/hc/en-us/articles/115005310285-Available-column-types-on-monday-com), [monday.com API column types](https://developer.monday.com/api-reference/reference/column-types-reference), [monday.com dev features](https://support.monday.com/hc/en-us/articles/23981188339474-Unique-features-found-only-in-monday-dev). Third-party reviews were used only for confirmation. Re-check plan-gated features against the vendor sites before building them.

Status key: **Y** = Prometheus has it, **P** = partial, **N** = missing.

## 1. Linear

### 1.1 Object model
| Feature | Status |
|---|---|
| Teams (separate issue sequences, workflows, cycles) | N (Prometheus uses spaces and projects) |
| Issues with identifiers (`ENG-123`) | Y (`projectKey-number`) |
| Sub-issues, parent progress roll-up | N |
| Projects (status, lead, members, start and target date, progress, milestones) | P (no status, lead, members or milestones) |
| Project updates (health, posts over time) | N |
| Milestones | N |
| Initiatives (group of projects) | N |
| Cycles (time-boxed, auto-create, auto-roll unfinished work) | P (create, progress, assign; no auto-create or roll-over) |
| Labels (workspace and team) | P (per-issue labels, no label groups or parent labels) |
| Priority (None, Urgent, High, Medium, Low) | Y |
| Estimates (points or t-shirt) | N |
| Relations: blocks, blocked by, duplicate, related | N |
| Attachments | N |
| Comments, reactions, mentions | N |
| Activity history per issue | N |
| Subscriptions and notifications (inbox) | N |
| Favourites | N |
| Templates (issue, project, document) | N |
| Documents (project and team docs) | N |
| Asks and forms (intake) | N |
| Recurring issues | N |

### 1.2 Workflow
| Feature | Status |
|---|---|
| Custom statuses in categories (Backlog, Unstarted, Started, Completed, Canceled) | P (fixed status list, no categories) |
| Per-team workflow editing | N |
| Triage inbox with accept, decline, duplicate | N |
| Triage rules (auto-assign team, status, labels, priority) | N |
| Auto-close and auto-archive rules | N |
| Git branch names and PR status (GitHub, GitLab) | N |
| Keyboard-first command menu (Cmd+K) | N |
| Single-key shortcuts for set status, priority, label, assignee | N |

### 1.3 Views
| Feature | Status |
|---|---|
| Board (per cycle, project, or team) | Y (status only) |
| List (grouped, sorted) | P (grouped by status only) |
| Timeline (Gantt with dependencies) | P (bars, no dependencies) |
| Roadmap (projects over time) | Y (scoped to space) |
| Cycles view with graphs | P |
| Custom views (saved filters, shared, favourited) | N |
| Filters with AND and OR and any property | N |
| Display options (group by, sub-group by, order, show completed, show sub-issues, columns) | N |
| Insights and charts (burndown, created vs completed, scope) | N |

### 1.4 Automation and integrations
| Feature | Status |
|---|---|
| Built-in automation (auto-close, auto-archive, auto-add to cycle) | N |
| Triggers on issue, project, cycle and initiative changes | N |
| Slack, GitHub, GitLab, Figma, Sentry, Zendesk and similar | N |
| API and webhooks | N |
| Import from Jira, Asana, CSV | N |
| Agents assigned to issues | N (MCP exists for local agents only) |

## 2. monday.com

### 2.1 Structure
| Feature | Status |
|---|---|
| Workspaces | N |
| Folders | N |
| Boards (one per list of items) | P (Prometheus projects act as boards) |
| Groups inside a board | P (status groups only) |
| Items and subitems (nested table) | N |
| Item updates (comments with @mentions and attachments) | N |
| Docs (rich pages, can embed boards) | N |
| Forms (public intake to a board) | N |

### 2.2 Column types
Columns the API lists, with Prometheus status.

| monday column | Prometheus | Status |
|---|---|---|
| Status (labels with colour, group colour) | status | Y (no per-board colour setting or done-state rules) |
| Label (no colour rules) | dropdown | P |
| Priority | priority is fixed | P (fixed column, not a typed column) |
| Dropdown (multi-select) | dropdown | P (single-select only) |
| People (assignees, multi) | — | P (assignee is single text, not a people column) |
| Date (with time) | date | P (range only) |
| Timeline | timeline | Y |
| Numbers (sum, format) | number | P (sum only, no formats or currency) |
| Text | text | Y |
| Long text | long_text | Y |
| Checkbox | checkbox | Y |
| Rating | rating | Y |
| Link | link | Y |
| Email | email | Y |
| Phone | phone | Y |
| Tags | tags | Y |
| Progress (formula-based in monday) | progress | P |
| Creation log | created | Y |
| Last updated | updated | Y |
| Auto number | — | N |
| Files | — | N |
| Location | — | N |
| Hour | — | N |
| Week | — | N |
| World clock | — | N |
| Color picker | — | N |
| Vote | — | N |
| Time tracking | — | N |
| Formula | — | N |
| Mirror (show values from linked board) | — | N |
| Connect boards (link items across boards) | — | N |
| Dependency | — | N |
| Item ID | — | N |
| Button | — | N |
| Board relation | — | N |
| Doc | — | N |
| Subtasks (as column) | — | N |
| Integrations column (GitHub, Jira) | — | N |
| Mirror and formula | — | N |

Column-level features: header rename, hide, reorder, resize, pin, sort, group-footer summary (sum, average, count, min, max), per-column description, column default value, column validation (required, unique), column automations.

### 2.3 Views
| Feature | Status |
|---|---|
| Table | Y (Prometheus Table) |
| Kanban | Y (Board, status only) |
| Timeline (Gantt, dependencies) | P |
| Calendar | N |
| Gantt | P (same as Timeline) |
| Chart (bar, pie, line, sum over group) | N |
| Workload (hours per person over time) | N |
| Map (Location column) | N |
| Form view | N |
| Files gallery | N |
| Private view and personal views | N |
| Saved filters and sorts per view | N |
| Group by any column | N (status only) |
| Hide, show, and reorder columns per view | N |

### 2.4 Automation and recipes
| Feature | Status |
|---|---|
| Trigger-action automations ("when status changes, notify person") | N |
| Recipes (templated automations) | N |
| Cross-board item creation | N |
| Integrations (Slack, Teams, GitHub, Jira, Gmail, and others) | N |
| Webhooks and API | N |
| Formula and mirror columns | N |

### 2.5 Dashboards and reporting
| Feature | Status |
|---|---|
| Dashboard canvas with widgets | N |
| Widgets: chart, battery (progress), numbers, calendar, list, workload, status, portfolio | N |
| Cross-board dashboard | N |
| Reports (burndown, velocity for dev) | N |
| Sprint planning and burndown (monday dev) | N |

### 2.6 Collaboration and admin
| Feature | Status |
|---|---|
| Multi-user accounts, guests, roles | N (single local user) |
| Permissions per board and column | N |
| Notifications and inbox | N |
| Activity log per item and board | N |
| Templates (board, doc, form) | N |
| Import and export (CSV, Excel) | N |
| Audit log | N |

## 3. Gap summary (what 1:1 means here)

Full 1:1 with both products is a multi-quarter build and needs a multi-user backend. A local-first Electron app can reach near-parity on single-user features. The rest needs a sync server.

**Feasible locally (single user):**
- Sub-issues, relations, estimates, favourites, templates.
- Saved views with filters, grouping on any field, column show and hide, and per-view sorting.
- Command menu and single-key shortcuts.
- Triage inbox and cycle auto-create and roll-over.
- Project status, lead, milestones, and initiatives.
- Column types: people, dropdown (multi), label, priority, numbers formats, auto number, files (local), formula, mirror and connect boards (within local workspace), dependency, week, hour, location, color, vote, button, item ID, world clock, time tracking.
- Charts, calendar, workload, and dashboard widgets computed from local data.
- Automations (trigger and action engine in the main process).
- CSV import and export.
- Activity log per item.

**Needs a backend or multi-user:**
- Accounts, guests, roles, permissions, sharing.
- Real-time sync, comments with @mentions and notifications across users.
- Integrations that depend on third-party OAuth (Slack, GitHub, Jira, Gmail, Teams).
- Forms that accept public submissions.
- Docs with co-editing.

## 4. Phased plan

Each phase ends with typecheck passing and a manual check in the app. Phases are ordered by daily-use value.

**Phase 1: core issue model**
1. Sub-issues with parent progress roll-up.
2. Relations (blocks, blocked by, duplicate, related).
3. Comments and activity log per issue.
4. Favourites, estimates, and issue templates.
5. Command menu (Cmd+K) and single-key shortcuts.

**Phase 2: views and filtering**
6. Filter model (AND and OR, any property) shared across Board, Table, Timeline and Cycles.
7. Saved views with grouping on any field, sorting, and column show and hide.
8. Triage inbox with accept, decline, and duplicate.
9. Bulk select and bulk edit on Table and Board.

**Phase 3: columns**
10. People column (multi), dropdown (multi-select), label column.
11. Numbers formats and footer summaries (sum, average, count, min, max).
12. Dependency, auto number, item ID, week, hour, world clock, location, color picker, vote, and button columns.
13. Formula column (expression over other columns in the same board).
14. Mirror and connect-boards columns (references between local boards).
15. Files column (copy into app data folder).

**Phase 4: planning**
16. Cycle auto-create, auto-roll unfinished work, burndown and velocity.
17. Project status, lead, members, milestones, and project updates.
18. Initiatives above projects.
19. Timeline dependencies and roadmap zoom levels.

**Phase 5: reporting and automation**
20. Dashboard canvas with widgets (chart, numbers, progress, list, workload, calendar).
21. Chart view and calendar view.
22. Automation engine: triggers (status, date, assignee, column changed) and actions (set field, notify, create item, move to cycle).
23. CSV import and export.

**Phase 6: out of scope until a backend exists**
- Multi-user accounts, permissions, guests, real-time sync, third-party integrations, public forms, docs co-editing.

## 5. Decisions needed before Phase 1

- Confirm "1:1" means feature parity, not a visual clone. This plan assumes feature parity only.
- Confirm that the status model can change from the fixed list to status categories plus custom statuses per space.
- Confirm whether the data model moves from a single JSON file to a local database. Phase 2 and later need indexed queries.
