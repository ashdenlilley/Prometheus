// Status categories drive progress maths. Each space project defines its own statuses from these.
export type StatusCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export interface StatusDef {
  id: string
  label: string
  color: string
  category: StatusCategory
}

export const DEFAULT_STATUSES: StatusDef[] = [
  { id: 'backlog', label: 'Backlog', color: '#8a8f98', category: 'backlog' },
  { id: 'todo', label: 'Todo', color: '#c8ccd4', category: 'unstarted' },
  { id: 'in_progress', label: 'In Progress', color: '#f2c94c', category: 'started' },
  { id: 'done', label: 'Done', color: '#5e6ad2', category: 'completed' },
  { id: 'canceled', label: 'Canceled', color: '#6b6f78', category: 'canceled' }
]

// Index is the stored priority value (0 = none, 1 = urgent ... 4 = low)
export const PRIORITIES = ['No priority', 'Urgent', 'High', 'Medium', 'Low']

export type ColumnType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'status'
  | 'dropdown'
  | 'label'
  | 'priority'
  | 'people'
  | 'date'
  | 'timeline'
  | 'checkbox'
  | 'tags'
  | 'link'
  | 'email'
  | 'phone'
  | 'rating'
  | 'progress'
  | 'created'
  | 'updated'
  | 'auto_number'
  | 'item_id'
  | 'week'
  | 'hour'
  | 'location'
  | 'color'
  | 'vote'
  | 'button'
  | 'formula'
  | 'mirror'
  | 'board_relation'
  | 'dependency'
  | 'files'
  | 'world_clock'
  | 'time_tracking'
  | 'subtasks'

export interface SelectOption {
  id: string
  label: string
  color: string
}

export interface DateRange {
  start?: string
  end?: string
}

export interface FileRef {
  name: string
  size: number
  dataUrl: string
}

export type CellValue = string | number | boolean | string[] | DateRange | FileRef[]

export interface Column {
  id: string
  name: string
  type: ColumnType
  options?: SelectOption[]
  description?: string
  // number: display format and currency code
  numberFormat?: 'plain' | 'currency' | 'percent' | 'decimal'
  currency?: string
  // date: also store and edit a time of day (unset = date only)
  includeTime?: boolean
  // footer summary under each group
  footer?: 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max'
  required?: boolean
  // formula: expression over other numeric columns by name, e.g. "Estimate * 2"
  formula?: string
  buttonAction?: AutomationAction // button: run this on click; unset = click counter only
  buttonLabel?: string
  // progress: 'subissues' derives the value from sub-issues; manual (default, unset) uses the stored value
  progressMode?: 'manual' | 'subissues'
  // board_relation: target project id. mirror: relation column id + field to show.
  linkProjectId?: string
  relationColumnId?: string
  mirrorField?: string
}

export interface LabelDef {
  name: string
  color: string
  group?: string
}

// Snapshot of a project's setup, copied into new projects with new ids.
export interface ProjectTemplate {
  id: string
  name: string
  project: Project
  automations: Automation[]
  triageRules: TriageRule[]
  issues: Issue[]
  createdAt: string
}

export interface Space {
  id: string
  name: string
  color: string
  labels?: LabelDef[] // shared labels for every project in the space
  projectTemplates?: ProjectTemplate[]
  folders?: Folder[]
}

export interface Folder {
  id: string
  name: string
  collapsed?: boolean
}

export interface Initiative {
  id: string
  spaceId: string
  name: string
  color: string
  targetDate?: string
  status: 'planned' | 'active' | 'done'
}

export type ProjectStatus = 'planned' | 'in_progress' | 'paused' | 'completed' | 'canceled'

export interface Milestone {
  id: string
  name: string
  date?: string
  done: boolean
}

export interface ProjectUpdate {
  id: string
  at: string
  health: 'on_track' | 'at_risk' | 'off_track'
  body: string
}

export interface SavedView {
  id: string
  name: string
  view: 'list' | 'board' | 'table' | 'chart'
  filter: FilterGroup
  groupBy: string | null
  rowsBy?: string | null
  sort: Sort | null
  hidden: string[]
  showCompleted?: boolean
  chartType?: 'bar' | 'pie' | 'line'
  favourite?: boolean
  personal?: boolean // this device only; never synced
  order?: string[] // table column order for this view; falls back to project.order
}

export type Operator = 'is' | 'is_not' | 'contains' | 'gt' | 'lt' | 'empty' | 'not_empty'

export interface Condition {
  key: string
  op: Operator
  value?: string | number
}

export interface FilterGroup {
  match: 'all' | 'any'
  conditions: Condition[]
}

export interface Sort {
  key: string
  dir: 'asc' | 'desc'
}

export type AutomationTrigger =
  | { type: 'status_changed'; to: string }
  | { type: 'priority_changed'; to: number }
  | { type: 'assignee_changed' }
  | { type: 'due_passed' }
  | { type: 'column_changed'; columnId: string; to?: string }
  | { type: 'project_status_changed'; to?: ProjectStatus }
  | { type: 'cycle_started' }
  | { type: 'cycle_ended' }
  | { type: 'initiative_status_changed'; to?: Initiative['status'] }

export type AutomationAction =
  | { type: 'set_status'; status: string }
  | { type: 'set_priority'; priority: number }
  | { type: 'set_assignee'; assignee: string }
  | { type: 'add_label'; label: string }
  | { type: 'move_to_cycle' }
  | { type: 'create_issue'; title: string; status?: string; projectId?: string }
  | { type: 'notify'; message: string }

export interface Automation {
  id: string
  projectId: string
  name: string
  enabled: boolean
  createdAt?: string
  trigger: AutomationTrigger
  action: AutomationAction
}

// A team owns the issue key, number sequence, workflow statuses, cycle settings and members.
export interface Team {
  id: string
  spaceId: string
  name: string
  key: string
  color: string
  members: string[]
  statuses: StatusDef[]
  nextNumber: number
  cycleLength: number
  autoCycles: boolean
  autoRollOver?: boolean
  archivedAt?: string
}

export interface Project {
  id: string
  spaceId: string
  teamId: string // exactly one team; statuses and cycle settings mirror the team
  name: string
  key: string
  color: string
  startDate?: string
  targetDate?: string
  status: ProjectStatus
  lead: string
  // Unset means points; 'tshirt' shows XS..XL but stores 1, 2, 3, 5, 8
  estimateScale?: 'points' | 'tshirt'
  mapTiles?: string // optional tile URL template; unset = offline map
  members: string[]
  initiativeId?: string
  folderId?: string // unset = space root
  statuses: StatusDef[]
  columns: Column[]
  // Column widths in px, keyed by fixed column key or custom column id
  widths: Record<string, number>
  // Table column order, by fixed key or custom column id. 'name' always leads.
  order?: string[]
  // Table/board hidden fixed or custom column keys
  hiddenColumns: string[]
  autoSubscribe?: boolean // default true: issues created in this project start subscribed
  // WIP limit per status id (board warns when exceeded)
  wipLimits: Record<string, number>
  // Automatic cycle creation: length in days, and whether to create the next one on load
  cycleLength: number
  autoCycles: boolean
  autoRollOver?: boolean
  capacity?: Record<string, number> // workload: max points per person per week
  // Housekeeping: cancel issues untouched for N days; archive completed/canceled issues untouched for N days
  autoClose?: { days: number; status: string }
  autoArchive?: { days: number }
  milestones: Milestone[]
  updates: ProjectUpdate[]
  views: SavedView[]
  forms?: IntakeForm[]
}

// One field of a local intake form. key: 'title' | 'description' | 'priority' | 'labels' | 'dueDate' | column id
export interface FormField {
  key: string /* 'title' | 'description' | 'priority' | 'labels' | 'dueDate' | column id */
  label?: string
  help?: string
  required?: boolean
}

// Local intake form: each submission becomes a triage item. labels are added to every submission.
export interface IntakeForm {
  id: string
  name: string
  description?: string
  fields: FormField[]
  labels?: string[]
}

export interface Comment {
  id: string
  author: string
  body: string
  at: string
  files?: FileRef[]
  reactions?: { emoji: string; by: string }[]
}

export type RelationType = 'blocks' | 'duplicate' | 'related'

export interface Relation {
  type: RelationType
  // Issue id this relation points at. Inverse (blocked by, duplicated by) is derived.
  targetId: string
}

export interface ActivityEntry {
  id: string
  at: string
  text: string
}

export interface Issue {
  id: string
  projectId: string
  number: number
  key?: string // stored team key prefix, set at creation and never rewritten
  title: string
  description: string
  status: string
  priority: number
  assignee: string
  labels: string[]
  cycleId?: string
  milestoneId?: string
  parentId?: string
  startDate?: string
  dueDate?: string
  estimate?: number
  favourite?: boolean
  recurrence?: Recurrence
  timer?: { columnId: string; start: string } // running time-tracking timer (one per issue)
  // Automation keys already run for this issue, e.g. "ruleId:2026-10-01", so timed rules fire once
  firedAutomations?: string[]
  // Triage inbox: new items wait here until accepted or declined
  triage?: boolean
  subscribed?: boolean // the local user follows the issue; changes from MCP or sync notify them
  relations: Relation[]
  comments: Comment[]
  activity: ActivityEntry[]
  values: Record<string, CellValue>
  createdAt: string
  updatedAt: string
  completedAt?: string
  archivedAt?: string // set by auto-archive; hidden from views until unarchived
}

// Copies the issue on a schedule. `next` is the YYYY-MM-DD of the next copy.
export interface Recurrence {
  kind: 'daily' | 'weekly' | 'monthly' | 'interval'
  weekdays?: number[] // 0=Sun..6=Sat, weekly
  monthDay?: number // 1..31, monthly
  every?: number // days, interval
  next: string
  dueInDays?: number // copy's due date = creation day + this
}

export interface Cycle {
  id: string
  projectId: string
  teamId?: string
  name: string
  startDate: string
  endDate: string
  capacity?: number // planned points budget
  // Set once a cycle was auto rolled over
  rolledOver?: boolean
  // Keys like "automationId:started" for cycle rules that already ran
  firedAutomations?: string[]
}

// Applied to new triage items whose fields match `when`. Sets the given fields; the item stays in triage.
export interface TriageRule {
  id: string
  projectId: string
  name: string
  enabled: boolean
  when: FilterGroup
  set: {
    assignee?: string
    status?: string
    priority?: number
    labels?: string[]
    cycleId?: string
  }
}

export interface Template {
  id: string
  projectId: string
  name: string
  title: string
  description: string
  status: string
  priority: number
  labels: string[]
  estimate?: number
}

export type WidgetType = 'numbers' | 'progress' | 'chart' | 'list' | 'workload' | 'overdue' | 'milestones' | 'cycle' | 'calendar' | 'portfolio'

export interface Widget {
  id: string
  type: WidgetType
  title: string
  // Scope: a project id, or undefined for the whole space
  projectId?: string
  groupBy?: string
}

export interface Dashboard {
  id: string
  spaceId: string
  name: string
  widgets: Widget[]
}

export interface Notification {
  id: string
  at: string
  text: string
  issueId?: string
  read: boolean
}

export interface AppData {
  version: 5
  spaces: Space[]
  initiatives: Initiative[]
  projects: Project[]
  teams: Team[]
  issues: Issue[]
  cycles: Cycle[]
  automations: Automation[]
  triageRules: TriageRule[]
  templates: Template[]
  dashboards: Dashboard[]
  notifications: Notification[]
  // Display name for the local user. Used for comment authors and notifications.
  me: string
}
