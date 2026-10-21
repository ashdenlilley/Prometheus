import { PRIORITIES, STATUSES, type CellValue, type Column, type ColumnType, type DateRange, type Issue } from '@shared/types'

export const COLUMN_TYPE_INFO: { type: ColumnType; label: string; glyph: string }[] = [
  { type: 'text', label: 'Text', glyph: 'Aa' },
  { type: 'long_text', label: 'Long text', glyph: '¶' },
  { type: 'number', label: 'Numbers', glyph: '#' },
  { type: 'status', label: 'Status', glyph: '●' },
  { type: 'dropdown', label: 'Dropdown', glyph: '▾' },
  { type: 'people', label: 'People', glyph: '@' },
  { type: 'date', label: 'Date', glyph: '□' },
  { type: 'timeline', label: 'Timeline', glyph: '⇢' },
  { type: 'checkbox', label: 'Checkbox', glyph: '☑' },
  { type: 'tags', label: 'Tags', glyph: '⌗' },
  { type: 'link', label: 'Link', glyph: '↗' },
  { type: 'email', label: 'Email', glyph: '✉' },
  { type: 'phone', label: 'Phone', glyph: '☎' },
  { type: 'rating', label: 'Rating', glyph: '★' },
  { type: 'progress', label: 'Progress', glyph: '%' },
  { type: 'created', label: 'Creation log', glyph: '+' },
  { type: 'updated', label: 'Last updated', glyph: '↻' }
]

export const HAS_OPTIONS: ColumnType[] = ['status', 'dropdown']

// Palette matches the label colours people expect from Monday status columns.
export const LABEL_COLORS = [
  '#00c875', '#fdab3d', '#e2445c', '#c4c4c4', '#579bfc', '#a25ddc',
  '#037f4c', '#66ccff', '#ff642e', '#ffcb00', '#401694', '#ff007f'
]

export const DEFAULT_STATUS_OPTIONS = [
  { id: 'working', label: 'Working on it', color: '#fdab3d' },
  { id: 'done', label: 'Done', color: '#00c875' },
  { id: 'stuck', label: 'Stuck', color: '#e2445c' },
  { id: 'idle', label: 'Not started', color: '#c4c4c4' }
]

export type FixedKey = 'name' | 'status' | 'priority' | 'assignee' | 'due'

export const FIXED_COLUMNS: { key: FixedKey; label: string; width: number }[] = [
  { key: 'name', label: 'Name', width: 320 },
  { key: 'status', label: 'Status', width: 150 },
  { key: 'priority', label: 'Priority', width: 140 },
  { key: 'assignee', label: 'Assignee', width: 150 },
  { key: 'due', label: 'Due date', width: 140 }
]

export function defaultWidth(c: Column) {
  switch (c.type) {
    case 'long_text':
    case 'tags':
    case 'timeline':
      return 220
    case 'checkbox':
    case 'rating':
    case 'number':
      return 130
    default:
      return 160
  }
}

// Summary shown in a group footer for the column, or '' when it has none.
export function summarize(col: Column, items: Issue[]): string {
  const values = items.map(i => i.values[col.id])
  switch (col.type) {
    case 'number': {
      const nums = values.filter((v): v is number => typeof v === 'number')
      return nums.length ? `Σ ${nums.reduce((a, b) => a + b, 0)}` : ''
    }
    case 'progress': {
      const nums = values.filter((v): v is number => typeof v === 'number')
      return nums.length ? `avg ${Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)}%` : ''
    }
    case 'checkbox':
      return `${values.filter(v => v === true).length}/${items.length}`
    default:
      return ''
  }
}

export function fixedSortValue(key: FixedKey, i: Issue): string | number {
  switch (key) {
    case 'name':
      return i.title.toLowerCase()
    case 'status':
      return STATUSES.findIndex(s => s.id === i.status)
    case 'priority':
      return i.priority === 0 ? 99 : i.priority
    case 'assignee':
      return i.assignee.toLowerCase()
    case 'due':
      return i.dueDate ?? '9999'
  }
}

export function customSortValue(col: Column, i: Issue): string | number {
  const v = i.values[col.id]
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    if (col.type === 'status' || col.type === 'dropdown') {
      const idx = col.options?.findIndex(o => o.id === v) ?? -1
      return idx < 0 ? '' : idx
    }
    return v.toLowerCase()
  }
  if (Array.isArray(v)) return v.join(',').toLowerCase()
  if (v && typeof v === 'object') return (v as DateRange).start ?? ''
  if (col.type === 'created') return i.createdAt
  if (col.type === 'updated') return i.updatedAt
  return ''
}

export function priorityLabel(value: number) {
  return PRIORITIES[value] ?? ''
}

export function isFilled(v: CellValue | undefined) {
  if (v === undefined || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  return true
}
