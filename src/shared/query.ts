import { categoryOf, createIssue } from './model'
import { PRIORITIES, type AppData, type Column, type Cycle, type Issue, type Project, type SavedView, type StatusDef } from './types'
import { formatEstimate, parseEstimate } from './estimate'
import { toISO } from './dates'
import { subtaskLabel, subtaskSummary } from './subtasks'
import { voteCount } from './votes'

// Read-side helpers: grouping, progress, summaries and CSV. Shared by renderer views and the main process.
// Field access and filtering live in ./filter.

import { applyFilter, customValue, emptyFilter, fieldValue, FIXED_FIELDS, isEmpty, type FieldValue, type FixedField } from './filter'
export { applyFilter, customValue, emptyFilter, fieldValue, FIXED_FIELDS, isEmpty, type FieldValue, type FixedField } from './filter'

export interface Group {
  key: string
  label: string
  items: Issue[]
  color?: string
}

// Groups issues by any field. Status groups follow the project's status order.
export function groupIssues(
  issues: Issue[],
  project: Project,
  groupBy: string | null,
  cycleName: (id: string) => string,
  milestoneName: (id: string) => string
): Group[] {
  if (!groupBy) return [{ key: 'all', label: '', items: issues }]

  if (groupBy === 'status') {
    return project.statuses.map(s => ({
      key: s.id,
      label: s.label,
      color: s.color,
      items: issues.filter(i => i.status === s.id)
    }))
  }

  const labelOf = (i: Issue): string => {
    if (groupBy === 'priority') return i.priority ? PRIORITIES[i.priority] : 'No priority'
    if (groupBy === 'cycle') return i.cycleId ? cycleName(i.cycleId) : 'No cycle'
    if (groupBy === 'milestone') return i.milestoneId ? milestoneName(i.milestoneId) : 'No milestone'
    if (groupBy === 'labels') return i.labels[0] ?? 'No label'
    const v = fieldValue(i, groupBy, project)
    const col = project.columns.find(c => c.id === groupBy)
    if (col?.options && typeof v === 'string') return col.options.find(o => o.id === v)?.label ?? v
    if (col?.options && Array.isArray(v) && v.length) return col.options.find(o => o.id === v[0])?.label ?? v[0]
    if (isEmpty(v)) return 'None'
    return Array.isArray(v) ? v[0] : String(v)
  }

  const map = new Map<string, Group>()
  for (const i of issues) {
    const label = labelOf(i)
    const existing = map.get(label)
    if (existing) existing.items.push(i)
    else map.set(label, { key: label, label, items: [i] })
  }
  const groups = [...map.values()]
  if (groupBy === 'priority') {
    const order = PRIORITIES.map((_, n) => PRIORITIES[n])
    return groups.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
  }
  return groups.sort((a, b) => (a.label === 'None' || a.label.startsWith('No ') ? 1 : b.label === 'None' || b.label.startsWith('No ') ? -1 : a.label.localeCompare(b.label)))
}

// Patch that moves an issue into the group `key` from groupIssues. Null when the grouping is not a settable field.
export function groupPatch(groupBy: string, key: string, project: Project, cycles: Cycle[]): Partial<Issue> | null {
  switch (groupBy) {
    case 'status':
      return { status: key }
    case 'priority': {
      const n = PRIORITIES.indexOf(key)
      return n < 0 ? null : { priority: n }
    }
    case 'assignee':
      return { assignee: key === 'None' ? '' : key }
    case 'cycle': {
      if (key === 'No cycle') return { cycleId: undefined }
      const c = cycles.find(c => c.projectId === project.id && c.name === key)
      return c ? { cycleId: c.id } : null
    }
    case 'milestone': {
      if (key === 'No milestone') return { milestoneId: undefined }
      const m = project.milestones.find(m => m.name === key)
      return m ? { milestoneId: m.id } : null
    }
    default:
      return null
  }
}

export interface Lane {
  key: string
  label: string
  count: number
  columns: Group[]
}

// Rows come from rowsBy; every lane shows the same columns (built from all issues), filtered to its own issues.
export function swimlanes(
  issues: Issue[],
  project: Project,
  columnsBy: string | null,
  rowsBy: string | null,
  cycleName: (id: string) => string,
  milestoneName: (id: string) => string
): Lane[] {
  const columns = groupIssues(issues, project, columnsBy, cycleName, milestoneName)
  if (!rowsBy) return [{ key: 'all', label: '', count: issues.length, columns }]
  return groupIssues(issues, project, rowsBy, cycleName, milestoneName).map(row => {
    const mine = new Set(row.items)
    return { key: row.key, label: row.label, count: row.items.length, columns: columns.map(c => ({ ...c, items: c.items.filter(i => mine.has(i)) })) }
  })
}

// Drops issues in a completed or canceled status. Used when "Show completed" is off.
export function withoutCompleted(issues: Issue[], project: Project | undefined): Issue[] {
  return issues.filter(i => {
    const cat = categoryOf(project, i.status)
    return cat !== 'completed' && cat !== 'canceled'
  })
}

// Saved views from before the toggle existed have no flag; they show completed issues.
export function viewShowsCompleted(v: Pick<SavedView, 'showCompleted'>): boolean {
  return v.showCompleted ?? true
}

export function progress(issues: Issue[], statuses: StatusDef[]) {
  const cat = (i: Issue) => statuses.find(s => s.id === i.status)?.category ?? 'unstarted'
  const live = issues.filter(i => cat(i) !== 'canceled')
  const done = live.filter(i => cat(i) === 'completed').length
  return { done, total: live.length, pct: live.length ? Math.round((done / live.length) * 100) : 0 }
}

export function childrenOf(issues: Issue[], parentId: string) {
  return issues.filter(i => i.parentId === parentId)
}

// Manual mode reads the stored value. Subissues mode uses sub-issue completion; with none, the issue counts as one item.
export function progressValue(column: Column, issue: Issue, issues: Issue[], statuses: StatusDef[]): number {
  if (column.progressMode !== 'subissues') {
    const v = issue.values[column.id]
    return Math.min(100, Math.max(0, typeof v === 'number' ? v : 0))
  }
  const subs = childrenOf(issues, issue.id)
  return progress(subs.length ? subs : [issue], statuses).pct
}

export function openIssue(project: Project | undefined, issue: Issue) {
  const c = categoryOf(project, issue.status)
  return c !== 'completed' && c !== 'canceled'
}

// Column summary for a group footer.
// issues and statuses are only read for progress columns (computed sub-issue progress).
export function summarize(col: Column, items: Issue[], issues: Issue[] = items, statuses: StatusDef[] = []): string {
  const values = items.map(i => (col.progressMode === 'subissues' ? progressValue(col, i, issues, statuses) : i.values[col.id]))
  const nums = values.filter((v): v is number => typeof v === 'number')
  const fmt = (n: number) => formatNumber(n, col)
  switch (col.footer ?? defaultFooter(col)) {
    case 'sum':
      return nums.length ? fmt(nums.reduce((a, b) => a + b, 0)) : ''
    case 'avg':
      return nums.length ? fmt(nums.reduce((a, b) => a + b, 0) / nums.length) : ''
    case 'min':
      return nums.length ? fmt(Math.min(...nums)) : ''
    case 'max':
      return nums.length ? fmt(Math.max(...nums)) : ''
    case 'count':
      return `${items.filter(i => !isEmpty(customValue(i, col))).length}`
    case 'none':
      return ''
  }
  return ''
}

function defaultFooter(col: Column): NonNullable<Column['footer']> {
  if (col.type === 'checkbox') return 'count'
  if (col.type === 'number' || col.type === 'progress') return 'sum'
  return 'none'
}

export function formatNumber(n: number, col?: Column): string {
  const rounded = Math.round(n * 100) / 100
  switch (col?.numberFormat) {
    case 'currency':
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: col.currency || 'USD' }).format(rounded)
    case 'percent':
      return `${rounded}%`
    case 'decimal':
      return rounded.toFixed(2)
    default:
      return String(rounded)
  }
}

export { evaluateFormula } from './formula'

// ───────────── Tabular export and import ─────────────

// Cell text shared by CSV and XLSX: arrays join with '; ', objects become JSON, empty is ''.
const cellText = (v: unknown) => (v === undefined || v === null ? '' : Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v))

const csvCell = (v: unknown) => {
  const s = cellText(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Header plus one row per issue. CSV and XLSX export both use it, so they carry the same columns and values.
export function issuesToRows(data: AppData, project: Project, issues: Issue[]): string[][] {
  const header = ['Key', 'Title', 'Status', 'Priority', 'Assignee', 'Labels', 'Start', 'Due', 'Estimate', 'Cycle', ...project.columns.map(c => c.name)]
  const rows = issues.map(i => {
    const cycle = data.cycles.find(c => c.id === i.cycleId)?.name
    const custom = project.columns.map(c =>
      c.progressMode === 'subissues' ? progressValue(c, i, data.issues, project.statuses)
        : c.type === 'vote' ? voteCount(i.values[c.id])
          : c.type === 'subtasks' ? subtaskLabel(subtaskSummary(data, i.id))
            : customValue(i, c))
    return [
      `${project.key}-${i.number}`,
      i.title,
      project.statuses.find(s => s.id === i.status)?.label ?? i.status,
      PRIORITIES[i.priority],
      i.assignee,
      i.labels.join('; '),
      i.startDate,
      i.dueDate,
      formatEstimate(i.estimate, project.estimateScale),
      cycle,
      ...custom
    ].map(cellText)
  })
  return [header, ...rows]
}

export function issuesToCSV(data: AppData, project: Project, issues: Issue[]): string {
  return issuesToRows(data, project, issues).map(r => r.map(csvCell).join(',')).join('\n')
}

// Minimal RFC 4180 parser. Returns rows of cells; first row is the header.
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let n = 0; n < text.length; n++) {
    const ch = text[n]
    if (quoted) {
      if (ch === '"' && text[n + 1] === '"') {
        cell += '"'
        n++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[n + 1] === '\n') n++
      row.push(cell)
      if (row.some(c => c !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some(c => c !== '')) rows.push(row)
  return rows
}

// XLSX cells as the same text a CSV would hold. Dates come out as local YYYY-MM-DD.
export function sheetText(rows: unknown[][]): string[][] {
  return rows.map(r => r.map(v => (v instanceof Date ? toISO(v) : cellText(v))))
}

// Rows to new issues. First row is the header. Title is required (the caller checks it); status and priority match labels.
// Returns [] when there is no Title column.
export function issuesFromRows(data: AppData, project: Project, rows: string[][]): Issue[] {
  const [header = [], ...body] = rows
  const col = (name: string) => header.findIndex(h => h.trim().toLowerCase() === name.toLowerCase())
  const titleAt = col('Title')
  if (titleAt < 0) return []
  const statusAt = col('Status')
  const priorityAt = col('Priority')
  const assigneeAt = col('Assignee')
  const dueAt = col('Due')
  const estimateAt = col('Estimate')
  const issues = body
    .filter(r => r[titleAt]?.trim())
    .map(r => {
      const statusLabel = statusAt >= 0 ? r[statusAt] : ''
      const status = project.statuses.find(s => s.label.toLowerCase() === statusLabel.toLowerCase())?.id ?? project.statuses[0].id
      const pri = priorityAt >= 0 ? PRIORITIES.indexOf(r[priorityAt]) : -1
      return createIssue(data, project.id, r[titleAt].trim(), {
        status,
        priority: pri > 0 ? pri : 0,
        assignee: assigneeAt >= 0 ? r[assigneeAt] : '',
        dueDate: dueAt >= 0 && r[dueAt] ? r[dueAt] : undefined,
        // Letters (XS–XL) or numbers, so an exported t-shirt project imports back.
        estimate: estimateAt >= 0 ? parseEstimate(r[estimateAt] ?? '', project.estimateScale) : undefined
      })
    })
  return issues.map((i, n) => ({ ...i, number: i.number + n }))
}
