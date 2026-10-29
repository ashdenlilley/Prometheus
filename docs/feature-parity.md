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
| Cycles (time-boxed, auto-create, auto-roll unfinished work) | Y (create, optional auto-create via the project's `autoCycles` setting, optional automatic roll-over of unfinished issues when a cycle ends via `autoRollOver` (undoable), manual roll-over button, progress, burndown. `CyclesView.tsx`, `shared/model.ts` rollOverCycle and autoRollOverCycles) |
| Labels (workspace and team) | P (per-project label column with coloured options, plus space-wide shared labels with optional groups where an issue keeps one label per group. `SpaceLabels.tsx`, `shared/labels.ts`, `IssueDetail.tsx`; no team labels or parent labels) |
| Priority (None, Urgent, High, Medium, Low) | Y (`shared/types.ts` PRIORITIES, `cells.tsx` PrioritySelect) |
| Estimates (points or t-shirt) | Y (per-project scale: points or t-shirt XS–XL stored as 1/2/3/5/8. `shared/estimate.ts`, `shared/types.ts` Project.estimateScale, `IssueDetail.tsx`) |
| Relations: blocks, blocked by, duplicate, related | Y (`shared/types.ts` Relation, `shared/model.ts` inverseRelations, `IssueDetail.tsx`) |
| Attachments | Y (Files column with 5 MB cap, stored in the data file. `cells.tsx` FilesEdit) |
| Comments, reactions, mentions | Y (comments, @mention notifications and emoji reactions. `shared/model.ts` addComment and toggleReaction, `IssueDetail.tsx`) |
| Activity history per issue | Y (`shared/model.ts` describeChanges, `IssueDetail.tsx` Activity) |
| Subscriptions and notifications (inbox) | Y (inbox from mentions, automation alerts and subscribed issues; issues are subscribed on create when the project auto-subscribes, and a bell in the drawer toggles it. Changes made locally do not notify; changes from sync or the MCP server do. `shared/subscriptions.ts`, `NotificationsPanel.tsx`) |
| Favourites | Y (`shared/types.ts` Issue.favourite, `FavGutter.tsx`, `IssueDetail.tsx`) |
| Templates (issue, project, document) | P (issue templates saved from `IssueDetail.tsx`; project templates saved from Project settings > Templates, with statuses, columns, views, automations, triage rules and optional starter issues, used from New project. `shared/projectTemplates.ts`, `NewProjectModal.tsx`; no document templates) |
| Documents (project and team docs) | N |
| Asks and forms (intake) | N |
| Recurring issues | Y (daily, weekly on chosen weekdays, monthly on a day, or every N days; the next copy is created on the app's tick with catch-up limited to one copy. Each copy has a deterministic ID from the template and period, so two synced devices create the same row and sync merges it. `shared/recurrence.ts`, `shared/model.ts` runRecurrences, `IssueDetail.tsx`) |

### 1.2 Workflow
| Feature | Status |
|---|---|
| Custom statuses in categories (Backlog, Unstarted, Started, Completed, Canceled) | Y (`shared/types.ts` StatusDef and StatusCategory, `ProjectSettings.tsx` Statuses) |
| Per-team workflow editing | Y (statuses are edited per project in `ProjectSettings.tsx`; a project is the team here) |
| Triage inbox with accept, decline, duplicate | Y (`TriageView.tsx`, `IssueDetail.tsx` Accept and Decline) |
| Triage rules (auto-assign team, status, labels, priority) | Y (`shared/types.ts` TriageRule, `shared/model.ts` intake, `ProjectSettings.tsx` Triage rules; sets assignee, status, priority, labels, cycle) |
| Auto-close and auto-archive rules | Y (per project: cancel open issues untouched for N days, archive completed or canceled issues untouched for N days; archived issues are listed and restored in Project settings > Archive, and hidden from Cycles, Triage, command search, dashboard widgets and Activity. `shared/model.ts` runHousekeeping, `shared/live.ts`) |
| Git branch names and PR status (GitHub, GitLab) | N |
| Keyboard-first command menu (Cmd+K) | Y (`App.tsx` Cmd+K handler, `CommandPalette.tsx`) |
| Single-key shortcuts for set status, priority, label, assignee | Y (s, p, l, a and f keys in the issue drawer. `IssueDetail.tsx`) |

### 1.3 Views
| Feature | Status |
|---|---|
| Board (per cycle, project, or team) | Y (`BoardView.tsx`: groups by any field, WIP limits per status, bulk bar) |
| List (grouped, sorted) | Y (`IssuesView.tsx`: group by any field, sort, bulk bar; `shared/query.ts` groupIssues) |
| Timeline (Gantt with dependencies) | Y (`TimelineView.tsx`: bars and arrows from blocks relations) |
| Roadmap (projects over time) | Y (`RoadmapView.tsx`, scoped to space, zoom levels) |
| Cycles view with graphs | Y (`CyclesView.tsx`: Burndown and velocity) |
| Custom views (saved filters, shared, favourited) | P (saved views per project and view kind store filter, group, sort, hidden columns, column order and chart type; a view can be starred and favourites are listed in the sidebar. `FilterBar.tsx`, `Sidebar.tsx`, `shared/views.ts`; not shared) |
| Filters with AND and OR and any property | Y (`shared/filter.ts`, `shared/types.ts` FilterGroup match all or any, `FilterBar.tsx`) |
| Display options (group by, sub-group by, order, show completed, show sub-issues, columns) | Y (group by any field, sub-group by as board swimlanes (`rowsBy`), sort, a show-completed toggle in List, Board and Table that saved views keep, hide and reorder columns per saved table view, sub-issues nested in `TableView.tsx`) |
| Insights and charts (burndown, created vs completed, scope) | Y (burndown with a scope line, velocity, created vs completed per cycle or for the last 8 weeks, bar, pie and line charts by any field. `CyclesView.tsx`, `ChartView.tsx`, `shared/insights.ts`) |

### 1.4 Automation and integrations
| Feature | Status |
|---|---|
| Built-in automation (auto-close, auto-archive, auto-add to cycle) | Y (`shared/model.ts` runAutomations, applyAction and runHousekeeping; move to current cycle, auto-close on inactivity and auto-archive) |
| Triggers on issue, project, cycle and initiative changes | Y (issue triggers: status, priority, assignee, due date and custom column changed; project status changed, cycle started or ended, initiative status changed. `shared/types.ts` AutomationTrigger, `shared/model.ts`) |
| Slack, GitHub, GitLab, Figma, Sentry, Zendesk and similar | N |
| API and webhooks | Y (local MCP server for agents, `src/main/mcp.ts`; localhost REST API at /api/v1 with create/read/update for issues and comments, `src/main/rest.ts`; per-project signed webhooks with retries, a delivery log and redeliver, sent from the device that made the change, `src/main/webhooks.ts`, `shared/webhooks.ts`, docs/api.md) |
| Import from Jira, Asana, CSV | Y (CSV import and export, plus file import of a Jira CSV export and an Asana CSV or JSON export with a preview and status mapping. `ImportModal.tsx`, `shared/importers.ts`; no live API import) |
| Agents assigned to issues | N (MCP exists for local agents, but assignee is free text and there is no agent assignee type) |

## 2. monday.com

### 2.1 Structure
| Feature | Status |
|---|---|
| Workspaces | Y (`shared/types.ts` Space, `NewSpaceModal.tsx`, `SpaceHome.tsx`) |
| Folders | Y (one level of folders per space; collapse, rename, delete, drag or pick a project into a folder. `Sidebar.tsx`, `shared/model.ts` addFolder and moveProjectToFolder) |
| Boards (one per list of items) | Y (projects with their own columns, statuses and views. `shared/types.ts` Project) |
| Groups inside a board | Y (group by any column: `shared/query.ts` groupIssues, `FilterBar.tsx`) |
| Items and subitems (nested table) | Y (sub-issues: `IssueDetail.tsx`, nested rows in `TableView.tsx`) |
| Item updates (comments with @mentions and attachments) | Y (comments with @mention notifications, file attachments (5 MB cap, stored in the data file) and reactions. `shared/model.ts` addComment) |
| Docs (rich pages, can embed boards) | N |
| Forms (public intake to a board) | P (local intake forms per project; each submission becomes a triage item, also through MCP `submit_form`. `ProjectSettings.tsx` Forms tab, `FormModal.tsx`, `shared/forms.ts`; no public link) |

### 2.2 Column types
Columns the API lists, with Prometheus status.

| monday column | Prometheus | Status |
|---|---|---|
| Status (labels with colour, group colour) | status | Y (`shared/types.ts` StatusDef with colour and category, `cells.tsx` PillSelect) |
| Label (no colour rules) | label | Y (`cells.tsx`, coloured options per column; `columns.ts` LABEL_COLORS) |
| Priority | priority | Y (`cells.tsx` PrioritySelect, typed column) |
| Dropdown (multi-select) | dropdown | Y (`cells.tsx` ChipPicker, multi-select) |
| People (assignees, multi) | people | Y (`cells.tsx` TagsInput, suggestions from project members) |
| Date (with time) | date | Y (optional "Include time" per column, stored as ISO; filters and sort compare by timestamp. `cells.tsx`, `shared/datetime.ts`) |
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
| Progress (formula-based in monday) | progress | Y (manual 0–100 slider, or computed from sub-issues per column (`progressMode`). `cells.tsx` ProgressEdit, `shared/query.ts` progressValue) |
| Creation log | created | Y (`cells.tsx`, `columns.ts`) |
| Last updated | updated | Y (`cells.tsx`, `columns.ts`) |
| Auto number | auto_number | Y (`cells.tsx`, `columns.ts`) |
| Files | files | Y (`cells.tsx` FilesEdit, 5 MB cap, stored in the data file) |
| Location | location | Y (address with optional coordinates, shown in the Map view. `cells.tsx`, `shared/location.ts`, `MapView.tsx`; no geocoding) |
| Hour | hour | Y (`cells.tsx`, time input) |
| Week | week | Y (`cells.tsx`, week input) |
| World clock | world_clock | Y (`cells.tsx` WorldClock, fixed list of zones) |
| Color picker | color | Y (`cells.tsx`, coloured options) |
| Vote | vote | Y (one vote per person, click again to un-vote; voters on hover. `cells.tsx`, `shared/votes.ts`) |
| Time tracking | time_tracking | Y (manual hours entry plus a start/stop timer that survives a restart and adds to the hours, rounded to 0.01 h. `cells.tsx`, `shared/timetrack.ts`) |
| Formula | formula | Y (`shared/formula.ts` evaluateFormula, `cells.tsx` FormulaValue) |
| Mirror (show values from linked board) | mirror | Y (`cells.tsx` MirrorValue, read-only) |
| Connect boards (link items across boards) | board_relation | Y (`cells.tsx` IssuePicker, `shared/types.ts` linkProjectId) |
| Dependency | dependency | Y (`cells.tsx` IssuePicker) |
| Item ID | item_id | Y (`cells.tsx`, `columns.ts`) |
| Button | button | Y (optional action on click: set status or priority, add a label, notify, create a sub-issue or move to the current cycle, as one undo step; otherwise a click counter. `cells.tsx`, `shared/model.ts` pressButton) |
| Board relation | board_relation | Y (same as Connect boards, `cells.tsx`) |
| Doc | — | N |
| Subtasks (as column) | subtasks | P (read-only done/total of sub-issues, sortable. `cells.tsx`, `shared/subtasks.ts`; the cell does not expand or open sub-issues) |
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
| Chart (bar, pie, line, sum over group) | Y (bar, pie or line chart of counts or estimate points by any field; the type is saved with the view. `ChartView.tsx`, `shared/chart.ts`) |
| Workload (hours per person over time) | Y (Workload view: points or issue count per person per week with optional capacity. `WorkloadView.tsx`, `shared/workload.ts`; issues need a due date) |
| Map (Location column) | Y (offline map of pins from a Location column; optional tile URL, off by default. `MapView.tsx`, `shared/location.ts`) |
| Form view | N |
| Files gallery | Y (Files view: Files-column and comment attachments with the Issues filters. `FilesView.tsx`, `shared/files.ts`) |
| Private view and personal views | Y (personal saved views stay on this device and are never synced. `FilterBar.tsx`, `shared/sync.ts` stripPersonal) |
| Saved filters and sorts per view | Y (`FilterBar.tsx` saveView stores filter, group, sort and hidden columns. `shared/types.ts` SavedView) |
| Group by any column | Y (`shared/query.ts` groupIssues, `FilterBar.tsx`) |
| Hide, show, and reorder columns per view | Y (with a saved table view active, hiding and reordering apply to that view; otherwise to the project. `TableView.tsx`, `shared/views.ts` resolveColumnLayout) |

### 2.4 Automation and recipes
| Feature | Status |
|---|---|
| Trigger-action automations ("when status changes, notify person") | Y (`shared/model.ts` runAutomations, `ProjectSettings.tsx` Automations with built-in recipes from `shared/recipes.ts`; create item can target another project in the same space; notify goes to the local user) |
| Recipes (templated automations) | N |
| Cross-board item creation | N (the create-issue action only creates items in the same project) |
| Integrations (Slack, Teams, GitHub, Jira, Gmail, and others) | N |
| Webhooks and API | Y (MCP, localhost REST API and signed outgoing webhooks; see docs/api.md. No REST delete, no public hosted API) |
| Formula and mirror columns | Y (`shared/formula.ts`, `cells.tsx`) |

### 2.5 Dashboards and reporting
| Feature | Status |
|---|---|
| Dashboard canvas with widgets | Y (`DashboardView.tsx`, `shared/types.ts` Dashboard and Widget) |
| Widgets: chart, battery (progress), numbers, calendar, list, workload, status, portfolio | Y (chart by status, progress, numbers, list, workload, overdue, milestones, cycle, a due-date calendar and a portfolio table. `DashboardView.tsx`, `shared/insights.ts`) |
| Cross-board dashboard | Y (widgets scoped to the whole space or one project. `shared/types.ts` Widget.projectId) |
| Reports (burndown, velocity for dev) | Y (`CyclesView.tsx` Burndown and velocity) |
| Sprint planning and burndown (monday dev) | Y (cycles with burndown and velocity, plus a Planning view with cycle capacity, a velocity suggestion and backlog moves. `PlanningView.tsx`, `shared/planning.ts`) |

### 2.6 Collaboration and admin
| Feature | Status |
|---|---|
| Multi-user accounts, guests, roles | N (single local user; folder sync between your own devices in `src/main/sync.ts`) |
| Permissions per board and column | N |
| Notifications and inbox | Y (`NotificationsPanel.tsx`, read state in `shared/model.ts` markNotifications) |
| Activity log per item and board | Y (per item in `IssueDetail.tsx`, and a project-level Activity view with issue and field filters and paging. `views/ActivityView.tsx`, `shared/activity.ts`) |
| Templates (board, doc, form) | P (issue templates and project (board) templates; no doc or form templates) |
| Import and export (CSV, Excel) | Y (CSV and Excel (.xlsx) import and export in `TableView.tsx`, `xlsx.ts`, using read-excel-file and write-excel-file) |
| Audit log | Y (append-only local log of every change with source (ui, mcp, sync), filters and CSV export; capped at 50,000 rows. Settings > Audit log, `main/db.ts`, `shared/audit.ts`) |

## 3. Gap summary (what 1:1 means here)

Full 1:1 with both products is a multi-quarter build and needs a multi-user backend. The local app already covers most single-user features. What is left is listed below.

**Still missing, feasible locally (single user):**
- Project and team documents (single user).
- Document templates.
- Team entities with their own membership.
- Cross-project item creation. Recipes.
- Agent as an assignee type.

**Needs a backend or multi-user:**
- Accounts, guests, roles, permissions, sharing.
- Real-time sync between users, and comments with @mentions and notifications across users. (Folder sync between your own devices already exists.)
- Integrations that depend on third-party OAuth (Slack, GitHub, GitLab, Jira, Gmail, Teams), including git branch and PR status.
- Webhooks sent by a server when no device is open (today they are sent by the app on the device that made the change).
- Forms that accept public submissions.
- Docs with co-editing.

## 4. Phased plan

Each phase ends with typecheck passing and a manual check in the app. Phases are ordered by daily-use value. Items marked **Done** are implemented. Remaining work is listed under each open item.

**Phase 1: core issue model**
1. Sub-issues with parent progress roll-up. **Done.**
2. Relations (blocks, blocked by, duplicate, related). **Done.**
3. Comments and activity log per issue. **Done.** Reactions and subscriptions done.
4. Favourites, estimates, and issue templates. **Done.** T-shirt estimate scale and project templates done. Open: document templates.
5. Command menu (Cmd+K) and single-key shortcuts. **Done.** Drawer keys s, p, l, a and f.

**Phase 2: views and filtering**
6. Filter model (AND and OR, any property) shared across Board, Table, Timeline and Cycles. **Partial.** Done for Board, Table, List and Chart. Open: Timeline and Cycles do not use the filter bar.
7. Saved views with grouping on any field, sorting, and column show and hide. **Partial.** Done for saved views. Saved views also keep board rows (sub-group by), the show-completed toggle, the chart type and the table column order and hidden columns, and can be favourited into the sidebar. Open: shared views.
8. Triage inbox with accept, decline, and duplicate. **Done.**
9. Bulk select and bulk edit on Table and Board. **Done** (also on List).

**Phase 3: columns**
10. People column (multi), dropdown (multi-select), label column. **Done.**
11. Numbers formats and footer summaries (sum, average, count, min, max). **Done.**
12. Dependency, auto number, item ID, week, hour, world clock, color picker, vote, and button columns. **Done** as typed columns. Vote is per person, button can run an action, location has a map, and there is a subtasks column.
13. Formula column (expression over other columns in the same board). **Done.**
14. Mirror and connect-boards columns (references between local boards). **Done.**
15. Files column (copy into app data folder). **Done** (stored in the data file, 5 MB cap; not copied to a separate folder).

**Phase 4: planning**
16. Cycle auto-create, auto-roll unfinished work, burndown and velocity. **Done.** Auto-create, automatic roll-over (opt-in per project), burndown with scope line, velocity, created vs completed. Sprint planning view with capacity, and a workload view over time.
17. Project status, lead, members, milestones, and project updates. **Done.**
18. Initiatives above projects. **Done.**
19. Timeline dependencies and roadmap zoom levels. **Done.**

**Phase 5: reporting and automation**
20. Dashboard canvas with widgets (chart, numbers, progress, list, workload, calendar). **Done.** Includes calendar and portfolio widgets.
21. Chart view and calendar view. **Done.** Calendar, and bar, pie and line charts.
22. Automation engine: triggers (status, date, assignee, column changed) and actions (set field, notify, create item, move to cycle). **Done.** Status, priority, assignee, due-date and column-changed triggers; project, cycle and initiative triggers; set field, notify, create sub-item or cross-project item, move to cycle; built-in recipes.
23. CSV and Excel import and export. **Done.**

**Phase 6: out of scope until a backend exists**
- Multi-user accounts, permissions, guests, real-time sync, third-party integrations, public forms, docs co-editing.

## 5. Decisions (resolved)

- "1:1" means feature parity, not a visual clone. This plan assumes feature parity only.
- Status model: resolved. Statuses are custom per project with categories (`shared/types.ts` StatusDef and StatusCategory).
- Data model: resolved. Data lives in a local SQLite database (`prometheus.db` in the Electron `userData` folder, via sql.js in `src/main/db.ts`); the old `prometheus-data.json` file is only read as a legacy source (`src/main/index.ts`).
