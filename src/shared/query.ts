import { categoryOf } from './model'
import { PRIORITIES, type AppData, type Column, type Issue, type Project, type StatusDef } from './types'

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

export function progress(issues: Issue[], statuses: StatusDef[]) {
  const cat = (i: Issue) => statuses.find(s => s.id === i.status)?.category ?? 'unstarted'
  const live = issues.filter(i => cat(i) !== 'canceled')
  const done = live.filter(i => cat(i) === 'completed').length
  return { done, total: live.length, pct: live.length ? Math.round((done / live.length) * 100) : 0 }
}

export function childrenOf(issues: Issue[], parentId: string) {
  return issues.filter(i => i.parentId === parentId)
}

export function openIssue(project: Project | undefined, issue: Issue) {
  const c = categoryOf(project, issue.status)
  return c !== 'completed' && c !== 'canceled'
}

// Column summary for a group footer.
export function summarize(col: Column, items: Issue[]): string {
  const values = items.map(i => i.values[col.id])
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

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function issuesToCSV(data: AppData, project: Project, issues: Issue[]): string {
  const header = ['Key', 'Title', 'Status', 'Priority', 'Assignee', 'Labels', 'Start', 'Due', 'Estimate', 'Cycle', ...project.columns.map(c => c.name)]
  const rows = issues.map(i => {
    const cycle = data.cycles.find(c => c.id === i.cycleId)?.name
    // Raw values: the whole row is escaped once below.
    const custom = project.columns.map(c => customValue(i, c))
    return [
      `${project.key}-${i.number}`,
      i.title,
      project.statuses.find(s => s.id === i.status)?.label ?? i.status,
      PRIORITIES[i.priority],
      i.assignee,
      i.labels.join('; '),
      i.startDate,
      i.dueDate,
      i.estimate,
      cycle,
      ...custom
    ].map(csvCell).join(',')
  })
  return [header.map(csvCell).join(','), ...rows].join('\n')
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
