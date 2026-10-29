import type { Column, Condition, CellValue, FilterGroup, Issue, Project } from './types'
import { dateValueMs } from './datetime'

// Field access and filtering. Used by the renderer views and by automation rules in the reducer,
// so it depends only on types.

// 'favourite' is filter-only: it has no table column.
export type FixedField = 'name' | 'status' | 'priority' | 'assignee' | 'due' | 'start' | 'estimate' | 'labels' | 'cycle' | 'milestone' | 'pr' | 'favourite'

export const FIXED_FIELDS: { key: FixedField; label: string; width: number }[] = [
  { key: 'name', label: 'Name', width: 320 },
  { key: 'status', label: 'Status', width: 150 },
  { key: 'priority', label: 'Priority', width: 140 },
  { key: 'assignee', label: 'Assignee', width: 150 },
  { key: 'due', label: 'Due date', width: 140 },
  { key: 'start', label: 'Start date', width: 140 },
  { key: 'estimate', label: 'Estimate', width: 110 },
  { key: 'labels', label: 'Labels', width: 200 },
  { key: 'cycle', label: 'Cycle', width: 140 },
  { key: 'milestone', label: 'Milestone', width: 160 },
  { key: 'pr', label: 'PR', width: 110 }
]

export type FieldValue = string | number | boolean | string[] | undefined

// Value of a field on an issue. `key` is a fixed field or a custom column id.
export function fieldValue(issue: Issue, key: string, project: Project | undefined): FieldValue {
  switch (key as FixedField) {
    case 'favourite':
      return issue.favourite ? 'yes' : 'no'
    case 'name':
      return issue.title
    case 'status':
      return issue.status
    case 'priority':
      return issue.priority
    case 'assignee':
      return issue.assignee || undefined
    case 'due':
      return issue.dueDate
    case 'start':
      return issue.startDate
    case 'estimate':
      return issue.estimate
    case 'labels':
      return issue.labels
    case 'cycle':
      return issue.cycleId
    case 'milestone':
      return issue.milestoneId
    case 'pr':
      return issue.prState ?? undefined
  }
  const cols = project?.columns ?? []
  for (const col of cols) {
    if (col.id === key) return customValue(issue, col)
  }
  return undefined
}

// Custom column value normalised to a FieldValue. Formula and mirror values are computed elsewhere.
export function customValue(issue: Issue, col: Column): FieldValue {
  const v: CellValue | undefined = issue.values[col.id]
  if (v === undefined) return undefined
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.length && typeof v[0] === 'string' ? (v as string[]) : (v as unknown as { name: string }[]).map(f => f.name)
  return v.start ?? v.end
}

export function isEmpty(v: FieldValue) {
  return v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

function matches(c: Condition, v: FieldValue, isDate = false): boolean {
  switch (c.op) {
    case 'empty':
      return isEmpty(v)
    case 'not_empty':
      return !isEmpty(v)
    case 'is':
      return Array.isArray(v) ? v.includes(String(c.value)) : String(v ?? '') === String(c.value ?? '')
    case 'is_not':
      return !matches({ ...c, op: 'is' }, v)
    case 'contains': {
      const needle = String(c.value ?? '').toLowerCase()
      if (Array.isArray(v)) return v.some(x => x.toLowerCase().includes(needle))
      return String(v ?? '').toLowerCase().includes(needle)
    }
    case 'gt':
      return v !== undefined && c.value !== undefined && (typeof v === 'number' ? v > Number(c.value) : compare(isDate, v, c.value) > 0)
    case 'lt':
      return v !== undefined && c.value !== undefined && (typeof v === 'number' ? v < Number(c.value) : compare(isDate, v, c.value) < 0)
  }
}

// Date columns compare as epoch ms so date-only and timestamp values order correctly.
function compare(isDate: boolean, a: FieldValue, b: NonNullable<Condition['value']>): number {
  if (isDate) return dateValueMs(String(a)) - dateValueMs(String(b))
  return String(a) > String(b) ? 1 : String(a) < String(b) ? -1 : 0
}

export function applyFilter(issues: Issue[], filter: FilterGroup, project: Project | undefined): Issue[] {
  if (filter.conditions.length === 0) return issues
  return issues.filter(i => {
    const hits = filter.conditions.map(c => matches(c, fieldValue(i, c.key, project), project?.columns.find(col => col.id === c.key)?.type === 'date'))
    return filter.match === 'all' ? hits.every(Boolean) : hits.some(Boolean)
  })
}

export function emptyFilter(): FilterGroup {
  return { match: 'all', conditions: [] }
}
