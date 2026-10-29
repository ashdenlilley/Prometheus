# Feature parity: Prometheus vs Linear and monday.com

Scope: feature sets only. Brand, visual design, copy and icons are not copied. Builds on [research-feature-gap.md](research-feature-gap.md), which covers the same products at a higher level.

Sources: [Linear docs](https://docs.linear.app), [Making the most of Linear](https://linear.app/docs/making-the-most-of-linear), [Linear changelog](https://linear.app/changelog), [monday.com column types](https://support.monday.com/hc/en-us/articles/115005310285-Available-column-types-on-monday-com), [monday.com API column types](https://developer.monday.com/api-reference/reference/column-types-reference), [monday.com dev features](https://support.monday.com/hc/en-us/articles/23981188339474-Unique-features-found-only-in-monday-dev). Third-party reviews were used only for confirmation. Re-check plan-gated features against the vendor sites before building them.

Status key: **Y** = Prometheus has it, **P** = partial, **N** = missing. Evidence paths are under `src/`. Renderer components and views are given by file name only.

Last checked against the code: 2026-10-29.

## 1. Linear

### 1.1 Object model
| Feature | Status |
|---|---|
| Teams (separate issue sequences, workflows, cycles) | P (projects act as teams: own key and issue numbers, statuses and cycles; no team entity or membership. `shared/types.ts` Project) |
| Issues with identifiers (`ENG-123`) | Y (`shared/model.ts` issueKey) |
| Sub-issues, parent progress roll-up | Y (`shared/model.ts`, `shared/query.ts` childrenOf and progress, `IssueDetail.tsx`) |
| Projects (status, lead, members, start and target date, progress, milestones) | Y (`shared/types.ts` Project, `ProjectSettings.tsx` General tab, `RoadmapView.tsx` progress) |
| Project updates (health, posts over time) | Y (`ProjectSettings.tsx` Updates tab, `shared/types.ts` ProjectUpdate) |
| Milestones | Y (`ProjectSettings.tsx` Milestones tab, `IssueDetail.tsx` milestone field, `RoadmapView.tsx`) |
| Initiatives (group of projects) | Y (`shared/types.ts` Initiative, `ProjectSettings.tsx` General tab, `RoadmapView.tsx`) |
| Cycles (time-boxed, auto-create, auto-roll unfinished work) | P (create, optional auto-create on load via the project's `autoCycles` setting, progress, burndown; roll-over is a manual button, not automatic. `CyclesView.tsx`, `shared/model.ts` rollOverCycle) |
| Labels (workspace and team) | P (per-project label column with coloured options; no workspace or team labels, no label groups or parent labels. `cells.tsx`) |
| Priority (None, Urgent, High, Medium, Low) | Y (`shared/types.ts` PRIORITIES, `cells.tsx` PrioritySelect) |
| Estimates (points or t-shirt) | P (numeric points only, no t-shirt scale. `shared/types.ts` Issue.estimate, `IssueDetail.tsx`) |
| Relations: blocks, blocked by, duplicate, related | Y (`shared/types.ts` Relation, `shared/model.ts` inverseRelations, `IssueDetail.tsx`) |
| Attachments | Y (Files column with 5 MB cap, stored in the data file. `cells.tsx` FilesEdit) |
| Comments, reactions, mentions | P (comments and @mention notifications. `shared/model.ts` addComment, `IssueDetail.tsx`; no reactions) |
| Activity history per issue | Y (`shared/model.ts` describeChanges, `IssueDetail.tsx` Activity) |
| Subscriptions and notifications (inbox) | P (inbox from mentions and automation alerts. `NotificationsPanel.tsx`; no subscriptions) |
| Favourites | Y (`shared/types.ts` Issue.favourite, `FavGutter.tsx`, `IssueDetail.tsx`) |
| Templates (issue, project, document) | P (issue templates saved from `IssueDetail.tsx`, applied in `TableView.tsx`; no project or document templates) |
| Documents (project and team docs) | N |
| Asks and forms (intake) | N |
| Recurring issues | N |

### 1.2 Workflow
| Feature | Status |
|---|---|
| Custom statuses in categories (Backlog, Unstarted, Started, Completed, Canceled) | Y (`shared/types.ts` StatusDef and StatusCategory, `ProjectSettings.tsx` Statuses) |
| Per-team workflow editing | Y (statuses are edited per project in `ProjectSettings.tsx`; a project is the team here) |
| Triage inbox with accept, decline, duplicate | Y (`TriageView.tsx`, `IssueDetail.tsx` Accept and Decline) |
| Triage rules (auto-assign team, status, labels, priority) | Y (`shared/types.ts` TriageRule, `shared/model.ts` intake, `ProjectSettings.tsx` Triage rules; sets assignee, status, priority, labels, cycle) |
| Auto-close and auto-archive rules | P (automations can set status on a status change or when a due date passes; no auto-close on inactivity, no auto-archive. `shared/model.ts`) |
| Git branch names and PR status (GitHub, GitLab) | N |
| Keyboard-first command menu (Cmd+K) | Y (`App.tsx` Cmd+K handler, `CommandPalette.tsx`) |
| Single-key shortcuts for set status, priority, label, assignee | P (s, p and f keys in the issue drawer only; no label or assignee keys. `IssueDetail.tsx`) |

### 1.3 Views
| Feature | Status |
|---|---|
| Board (per cycle, project, or team) | Y (`BoardView.tsx`: groups by any field, WIP limits per status, bulk bar) |
| List (grouped, sorted) | Y (`IssuesView.tsx`: group by any field, sort, bulk bar; `shared/query.ts` groupIssues) |
| Timeline (Gantt with dependencies) | Y (`TimelineView.tsx`: bars and arrows from blocks relations) |
| Roadmap (projects over time) | Y (`RoadmapView.tsx`, scoped to space, zoom levels) |
| Cycles view with graphs | Y (`CyclesView.tsx`: Burndown and velocity) |
| Custom views (saved filters, shared, favourited) | P (saved views per project and view kind store filter, group, sort and hidden columns. `FilterBar.tsx`, `shared/types.ts` SavedView; not shared or favourited) |
| Filters with AND and OR and any property | Y (`shared/filter.ts`, `shared/types.ts` FilterGroup match all or any, `FilterBar.tsx`) |
| Display options (group by, sub-group by, order, show completed, show sub-issues, columns) | P (group by any field, sort, hide columns, sub-issues nested in `TableView.tsx`; no sub-group by, no show-completed toggle) |
| Insights and charts (burndown, created vs completed, scope) | P (burndown and velocity, bar chart by any field; no created vs completed chart, no scope line. `CyclesView.tsx`, `ChartView.tsx`) |

### 1.4 Automation and integrations
| Feature | Status |
|---|---|
| Built-in automation (auto-close, auto-archive, auto-add to cycle) | P (`shared/model.ts` runAutomations and applyAction; move to current cycle exists; no auto-close on inactivity, no auto-archive) |
| Triggers on issue, project, cycle and initiative changes | P (issue triggers only: status, priority, assignee, due date. `shared/types.ts` AutomationTrigger) |
| Slack, GitHub, GitLab, Figma, Sentry, Zendesk and similar | N |
| API and webhooks | P (local HTTP MCP server for agents, `src/main/mcp.ts`; no webhooks, no public REST API) |
| Import from Jira, Asana, CSV | P (CSV import and export, `TableView.tsx` with `shared/query.ts` parseCSV and issuesToCSV; no Jira or Asana import) |
| Agents assigned to issues | N (MCP exists for local agents, but assignee is free text and there is no agent assignee type) |

## 2. monday.com

### 2.1 Structure
| Feature | Status |
|---|---|
| Workspaces | Y (`shared/types.ts` Space, `NewSpaceModal.tsx`, `SpaceHome.tsx`) |
| Folders | N |
| Boards (one per list of items) | Y (projects with their own columns, statuses and views. `shared/types.ts` Project) |
| Groups inside a board | Y (group by any column: `shared/query.ts` groupIssues, `FilterBar.tsx`) |
| Items and subitems (nested table) | Y (sub-issues: `IssueDetail.tsx`, nested rows in `TableView.tsx`) |
| Item updates (comments with @mentions and attachments) | P (comments with @mention notifications; no attachments on comments. `shared/model.ts` addComment) |
| Docs (rich pages, can embed boards) | N |
| Forms (public intake to a board) | N |

### 2.2 Column types
Columns the API lists, with Prometheus status.

| monday column | Prometheus | Status |
|---|---|---|
| Status (labels with colour, group colour) | status | Y (`shared/types.ts` StatusDef with colour and category, `cells.tsx` PillSelect) |
| Label (no colour rules) | label | Y (`cells.tsx`, coloured options per column; `columns.ts` LABEL_COLORS) |
| Priority | priority | Y (`cells.tsx` PrioritySelect, typed column) |
| Dropdown (multi-select) | dropdown | Y (`cells.tsx` ChipPicker, multi-select) |
| People (assignees, multi) | people | Y (`cells.tsx` TagsInput, suggestions from project members) |
| Date (with time) | date | P (date only; time is a separate Hour column. `cells.tsx`) |
| Timeline | timeline | Y (`cells.tsx` date range) |
| Numbers (sum, format) | number | Y (`shared/types.ts` numberFormat, currency and footer; `shared/query.ts` formatNumber and summarize) |
| Text | text | Y (`cells.tsx`) |
| Long text | long_text | Y (`cells.tsx`) |
| Checkbox | checkbox | Y (`cells.tsx`) |
| Rating | rating | Y (`cells.tsx` Rating) |
| Link | link | Y (`cells.tsx`, opens externally) |
| Email | email | Y (`cells.tsx`) |
| Phone | phone | Y (`cells.tsx`; no click-to-call) |
| Tags | tags | Y (`cells.tsx` TagsInput) |
| Progress (formula-based in monday) | progress | P (manual 0–100 slider, not computed from sub-items or status. `cells.tsx` ProgressEdit) |
| Creation log | created | Y (`cells.tsx`, `columns.ts`) |
| Last updated | updated | Y (`cells.tsx`, `columns.ts`) |
| Auto number | auto_number | Y (`cells.tsx`, `columns.ts`) |
| Files | files | Y (`cells.tsx` FilesEdit, 5 MB cap, stored in the data file) |
| Location | location | P (free-text address; no map or coordinates. `cells.tsx`) |
| Hour | hour | Y (`cells.tsx`, time input) |
| Week | week | Y (`cells.tsx`, week input) |
| World clock | world_clock | Y (`cells.tsx` WorldClock, fixed list of zones) |
| Color picker | color | Y (`cells.tsx`, coloured options) |
| Vote | vote | P (click adds a count; no per-person votes or un-vote. `cells.tsx`) |
| Time tracking | time_tracking | P (manual hours entry, no timer. `cells.tsx`) |
| Formula | formula | Y (`shared/formula.ts` evaluateFormula, `cells.tsx` FormulaValue) |
| Mirror (show values from linked board) | mirror | Y (`cells.tsx` MirrorValue, read-only) |
| Connect boards (link items across boards) | board_relation | Y (`cells.tsx` IssuePicker, `shared/types.ts` linkProjectId) |
| Dependency | dependency | Y (`cells.tsx` IssuePicker) |
| Item ID | item_id | Y (`cells.tsx`, `columns.ts`) |
| Button | button | P (click counter only; no action. `cells.tsx`) |
| Board relation | board_relation | Y (same as Connect boards, `cells.tsx`) |
| Doc | — | N |
| Subtasks (as column) | — | N |
| Integrations column (GitHub, Jira) | — | N |
| Mirror and formula | mirror, formula | Y (`cells.tsx` MirrorValue and FormulaValue, `shared/formula.ts`) |

Column-level features: header rename, hide, reorder, resize, pin, sort, group-footer summary (sum, average, count, min, max), per-column description, column default value, column validation (required, unique), column automations. These are listed as prose, not as table rows, so they are not given a status here. Most are present in code (`shared/types.ts` Column has footer, required and description; `TableView.tsx` handles resize, order, sort and hide).

### 2.3 Views
| Feature | Status |
|---|---|
| Table | Y (`TableView.tsx`) |
| Kanban | Y (`BoardView.tsx`) |
| Timeline (Gantt, dependencies) | Y (`TimelineView.tsx`, arrows from blocks relations) |
| Calendar | Y (`CalendarView.tsx`) |
| Gantt | Y (same view as Timeline, `TimelineView.tsx`) |
| Chart (bar, pie, line, sum over group) | P (bar chart of counts or estimate points by any field; no pie or line. `ChartView.tsx`) |
| Workload (hours per person over time) | P (workload widget per person on the dashboard; no workload view, no change over time. `DashboardView.tsx`) |
| Map (Location column) | N |
| Form view | N |
| Files gallery | N |
| Private view and personal views | N |
| Saved filters and sorts per view | Y (`FilterBar.tsx` saveView stores filter, group, sort and hidden columns. `shared/types.ts` SavedView) |
| Group by any column | Y (`shared/query.ts` groupIssues, `FilterBar.tsx`) |
| Hide, show, and reorder columns per view | P (hide is per saved view; column order and hidden columns are per project. `TableView.tsx`, `shared/types.ts` Project) |

### 2.4 Automation and recipes
| Feature | Status |
|---|---|
| Trigger-action automations ("when status changes, notify person") | Y (`shared/model.ts` runAutomations, `ProjectSettings.tsx` Automations; notify goes to the local user) |
| Recipes (templated automations) | N |
| Cross-board item creation | N (the create-issue action only creates items in the same project) |
| Integrations (Slack, Teams, GitHub, Jira, Gmail, and others) | N |
| Webhooks and API | P (local HTTP MCP server, `src/main/mcp.ts`; no webhooks, no REST API) |
| Formula and mirror columns | Y (`shared/formula.ts`, `cells.tsx`) |

### 2.5 Dashboards and reporting
| Feature | Status |
|---|---|
| Dashboard canvas with widgets | Y (`DashboardView.tsx`, `shared/types.ts` Dashboard and Widget) |
| Widgets: chart, battery (progress), numbers, calendar, list, workload, status, portfolio | P (chart by status, progress, numbers, list, workload, overdue, milestones, cycle are present; no calendar or portfolio widget. `DashboardView.tsx`) |
| Cross-board dashboard | Y (widgets scoped to the whole space or one project. `shared/types.ts` Widget.projectId) |
| Reports (burndown, velocity for dev) | Y (`CyclesView.tsx` Burndown and velocity) |
| Sprint planning and burndown (monday dev) | P (cycles with burndown and velocity; no sprint planning view or capacity) |

### 2.6 Collaboration and admin
| Feature | Status |
|---|---|
| Multi-user accounts, guests, roles | N (single local user; folder sync between your own devices in `src/main/sync.ts`) |
| Permissions per board and column | N |
| Notifications and inbox | Y (`NotificationsPanel.tsx`, read state in `shared/model.ts` markNotifications) |
| Activity log per item and board | P (per item only; no board-level log. `IssueDetail.tsx` Activity) |
| Templates (board, doc, form) | P (issue templates only; no board, doc or form templates) |
| Import and export (CSV, Excel) | P (CSV import and export in `TableView.tsx`; no Excel) |
| Audit log | N |

## 3. Gap summary (what 1:1 means here)

Full 1:1 with both products is a multi-quarter build and needs a multi-user backend. The local app already covers most single-user features. What is left is listed below.

**Still missing, feasible locally (single user):**
- Subscriptions and reactions on issues. A board-level activity log.
- Project and team documents (single user).
- Recurring issues. Intake forms for local use. Project-level and board-level templates.
- Automatic cycle roll-over. Auto-close on inactivity and auto-archive rules.
- Automation triggers on project, cycle and initiative changes, and on column changes.
- Sub-group by, a show-completed toggle, and per-view column order and visibility (order and hidden columns are per project).
- Team entities with their own membership. Workspace-level labels and label groups.
- Estimates on a t-shirt scale. A date-with-time column. A progress column computed from sub-items. A time-tracking timer. A map for Location. Button actions. Per-person votes.
- Pie and line charts. Created vs completed chart and a scope line on the burndown. Calendar and portfolio dashboard widgets. A workload view over time. Map, gallery and personal views.
- Cross-project item creation. Recipes.
- Excel import and export. An audit log.
- Single-key shortcuts for label and assignee.
- Agent as an assignee type. Folders.

**Needs a backend or multi-user:**
- Accounts, guests, roles, permissions, sharing.
- Real-time sync between users, and comments with @mentions and notifications across users. (Folder sync between your own devices already exists.)
- Integrations that depend on third-party OAuth (Slack, GitHub, GitLab, Jira, Gmail, Teams), including git branch and PR status.
- Webhooks.
- Forms that accept public submissions.
- Docs with co-editing.

## 4. Phased plan

Each phase ends with typecheck passing and a manual check in the app. Phases are ordered by daily-use value. Items marked **Done** are implemented. Remaining work is listed under each open item.

**Phase 1: core issue model**
1. Sub-issues with parent progress roll-up. **Done.**
2. Relations (blocks, blocked by, duplicate, related). **Done.**
3. Comments and activity log per issue. **Done.** Open: reactions, subscriptions.
4. Favourites, estimates, and issue templates. **Done.** Open: t-shirt estimate scale, project and document templates.
5. Command menu (Cmd+K) and single-key shortcuts. **Command menu done.** Open: single-key shortcuts for label and assignee.

**Phase 2: views and filtering**
6. Filter model (AND and OR, any property) shared across Board, Table, Timeline and Cycles. **Partial.** Done for Board, Table, List and Chart. Open: Timeline and Cycles do not use the filter bar.
7. Saved views with grouping on any field, sorting, and column show and hide. **Partial.** Done for saved views. Open: column order and hidden columns are per project, not per view; sub-group by; shared or favourite views.
8. Triage inbox with accept, decline, and duplicate. **Done.**
9. Bulk select and bulk edit on Table and Board. **Done** (also on List).

**Phase 3: columns**
10. People column (multi), dropdown (multi-select), label column. **Done.**
11. Numbers formats and footer summaries (sum, average, count, min, max). **Done.**
12. Dependency, auto number, item ID, week, hour, world clock, color picker, vote, and button columns. **Done** as typed columns. Open: vote is a count only; button has no action; location has no map.
13. Formula column (expression over other columns in the same board). **Done.**
14. Mirror and connect-boards columns (references between local boards). **Done.**
15. Files column (copy into app data folder). **Done** (stored in the data file, 5 MB cap; not copied to a separate folder).

**Phase 4: planning**
16. Cycle auto-create, auto-roll unfinished work, burndown and velocity. **Partial.** Done: auto-create, burndown, velocity. Open: automatic roll-over (manual button only); scope line on burndown.
17. Project status, lead, members, milestones, and project updates. **Done.**
18. Initiatives above projects. **Done.**
19. Timeline dependencies and roadmap zoom levels. **Done.**

**Phase 5: reporting and automation**
20. Dashboard canvas with widgets (chart, numbers, progress, list, workload, calendar). **Partial.** Done: canvas and all widgets except calendar. Open: calendar widget, portfolio widget.
21. Chart view and calendar view. **Partial.** Calendar done. Open: pie and line charts (chart view is bar only).
22. Automation engine: triggers (status, date, assignee, column changed) and actions (set field, notify, create item, move to cycle). **Partial.** Done: status, priority, assignee and due-date triggers; set field, notify, create sub-item, move to cycle. Open: column-changed trigger; project, cycle and initiative triggers.
23. CSV import and export. **Done** (no Excel).

**Phase 6: out of scope until a backend exists**
- Multi-user accounts, permissions, guests, real-time sync, third-party integrations, public forms, docs co-editing.

## 5. Decisions (resolved)

- "1:1" means feature parity, not a visual clone. This plan assumes feature parity only.
- Status model: resolved. Statuses are custom per project with categories (`shared/types.ts` StatusDef and StatusCategory).
- Data model: resolved. Data lives in a local SQLite database (`prometheus.db` in the Electron `userData` folder, via sql.js in `src/main/db.ts`); the old `prometheus-data.json` file is only read as a legacy source (`src/main/index.ts`).
