import type { AppData, Column, ColumnType, Issue, Project } from '@shared/types'
import { FIXED_FIELDS, fieldValue, customValue, type FixedField } from '@shared/query'
import { categoryOf } from '@shared/model'
import { dateValueMs } from '@shared/datetime'
import { isAgentAssignee } from '@shared/agents'
import { subtaskSummary } from '@shared/subtasks'
import { voteCount } from '@shared/votes'

export const COLUMN_TYPE_INFO: { type: ColumnType; label: string; glyph: string; group: string }[] = [
  { type: 'text', label: 'Text', glyph: 'Aa', group: 'Basic' },
  { type: 'long_text', label: 'Long text', glyph: '¶', group: 'Basic' },
  { type: 'number', label: 'Numbers', glyph: '#', group: 'Basic' },
  { type: 'checkbox', label: 'Checkbox', glyph: '☑', group: 'Basic' },
  { type: 'rating', label: 'Rating', glyph: '★', group: 'Basic' },
  { type: 'progress', label: 'Progress', glyph: '%', group: 'Basic' },
  { type: 'status', label: 'Status', glyph: '●', group: 'Select' },
  { type: 'dropdown', label: 'Dropdown', glyph: '▾', group: 'Select' },
  { type: 'label', label: 'Label', glyph: '◆', group: 'Select' },
  { type: 'priority', label: 'Priority', glyph: '!', group: 'Select' },
  { type: 'tags', label: 'Tags', glyph: '⌗', group: 'Select' },
  { type: 'color', label: 'Color', glyph: '◉', group: 'Select' },
  { type: 'people', label: 'People', glyph: '@', group: 'People' },
  { type: 'vote', label: 'Vote', glyph: '👍', group: 'People' },
  { type: 'date', label: 'Date', glyph: '□', group: 'Time' },
  { type: 'timeline', label: 'Timeline', glyph: '⇢', group: 'Time' },
  { type: 'week', label: 'Week', glyph: 'W', group: 'Time' },
  { type: 'hour', label: 'Hour', glyph: '⏱', group: 'Time' },
  { type: 'time_tracking', label: 'Time tracking', glyph: '◷', group: 'Time' },
  { type: 'world_clock', label: 'World clock', glyph: '🌐', group: 'Time' },
  { type: 'link', label: 'Link', glyph: '↗', group: 'Contact' },
  { type: 'email', label: 'Email', glyph: '✉', group: 'Contact' },
  { type: 'phone', label: 'Phone', glyph: '☎', group: 'Contact' },
  { type: 'location', label: 'Location', glyph: '⌖', group: 'Contact' },
  { type: 'formula', label: 'Formula', glyph: 'ƒ', group: 'Advanced' },
  { type: 'mirror', label: 'Mirror', glyph: '⧉', group: 'Advanced' },
  { type: 'doc', label: 'Doc', glyph: '📄', group: 'Advanced' },
  { type: 'board_relation', label: 'Connect projects', glyph: '⇄', group: 'Advanced' },
  { type: 'dependency', label: 'Dependency', glyph: '⛓', group: 'Advanced' },
  { type: 'files', label: 'Files', glyph: '📎', group: 'Advanced' },
  { type: 'auto_number', label: 'Auto number', glyph: '1.', group: 'Advanced' },
  { type: 'item_id', label: 'Item ID', glyph: '#ID', group: 'Advanced' },
  { type: 'button', label: 'Button', glyph: '▣', group: 'Advanced' },
  { type: 'subtasks', label: 'Subtasks', glyph: '⊞', group: 'Advanced' },
  { type: 'created', label: 'Creation log', glyph: '+', group: 'Advanced' },
  { type: 'updated', label: 'Last updated', glyph: '↻', group: 'Advanced' }
]

export const HAS_OPTIONS: ColumnType[] = ['status', 'dropdown', 'label', 'color']

export const LABEL_COLORS = [
  '#00c875', '#fdab3d', '#e2445c', '#c4c4c4', '#579bfc', '#a25ddc',
  '#037f4c', '#66ccff', '#ff642e', '#ffcb00', '#401694', '#ff007f'
]

export const PRIORITY_COLORS = ['#8a8f98', '#e2445c', '#fdab3d', '#ffcb00', '#579bfc']

export type FixedKey = FixedField

export const FIXED_COLUMNS = FIXED_FIELDS

export function defaultWidth(c: Column) {
  switch (c.type) {
    case 'long_text':
    case 'tags':
    case 'timeline':
    case 'people':
    case 'files':
      return 220
    case 'checkbox':
    case 'rating':
    case 'number':
    case 'vote':
    case 'week':
    case 'hour':
      return 130
    default:
      return 160
  }
}

export function fixedSortValue(key: FixedKey, i: Issue, project: Project): string | number {
  switch (key) {
    case 'name':
      return i.title.toLowerCase()
    case 'status':
      return project.statuses.findIndex(s => s.id === i.status)
    case 'priority':
      return i.priority === 0 ? 99 : i.priority
    case 'assignee':
      return i.assignee.toLowerCase()
    case 'due':
      return i.dueDate ?? '9999'
    case 'start':
      return i.startDate ?? '9999'
    case 'estimate':
      return i.estimate ?? Number.MAX_SAFE_INTEGER
    case 'labels':
      return i.labels.join(',').toLowerCase()
    case 'cycle':
      return i.cycleId ?? ''
    case 'milestone':
      return i.milestoneId ?? ''
    case 'favourite':
      return i.favourite ? 0 : 1
    case 'assigneeType':
      return i.assignee ? (isAgentAssignee(i.assignee) ? 'agent' : 'person') : ''
  }
}

export function customSortValue(col: Column, i: Issue, project: Project, data: AppData): string | number {
  if (col.type === 'created') return i.createdAt
  if (col.type === 'updated') return i.updatedAt
  if (col.type === 'auto_number' || col.type === 'item_id') return i.number
  if (col.type === 'vote') return voteCount(i.values[col.id])
  if (col.type === 'subtasks') return subtaskSummary(data, i.id).ratio
  const v = customValue(i, col)
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    if (col.type === 'date') return dateValueMs(v)
    if (col.type === 'status') return project.statuses.findIndex(s => s.id === v)
    if (col.type === 'dropdown' || col.type === 'label') return col.options?.findIndex(o => o.id === v) ?? -1
    return v.toLowerCase()
  }
  if (Array.isArray(v)) return v.join(',').toLowerCase()
  return ''
}

export function fixedValue(i: Issue, key: FixedKey, project: Project) {
  return fieldValue(i, key, project)
}

export const isDone = (project: Project, i: Issue) => categoryOf(project, i.status) === 'completed'
