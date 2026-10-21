export type Status = 'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled'

export const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: 'backlog', label: 'Backlog', color: '#8a8f98' },
  { id: 'todo', label: 'Todo', color: '#c8ccd4' },
  { id: 'in_progress', label: 'In Progress', color: '#f2c94c' },
  { id: 'done', label: 'Done', color: '#5e6ad2' },
  { id: 'canceled', label: 'Canceled', color: '#6b6f78' }
]

// Index is the stored priority value (0 = none, 1 = urgent ... 4 = low)
export const PRIORITIES = ['No priority', 'Urgent', 'High', 'Medium', 'Low']

export type ColumnType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'status'
  | 'dropdown'
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

export interface SelectOption {
  id: string
  label: string
  color: string
}

export interface DateRange {
  start?: string
  end?: string
}

export type CellValue = string | number | boolean | string[] | DateRange

export interface Column {
  id: string
  name: string
  type: ColumnType
  options?: SelectOption[]
}

export interface Space {
  id: string
  name: string
  color: string
}

export interface Project {
  id: string
  spaceId: string
  name: string
  key: string
  color: string
  startDate?: string
  targetDate?: string
  columns: Column[]
  // Column widths in px, keyed by fixed column key or custom column id
  widths: Record<string, number>
  // Table column order, by fixed key or custom column id. 'name' always leads.
  order?: string[]
}

export interface Issue {
  id: string
  projectId: string
  number: number
  title: string
  description: string
  status: Status
  priority: number
  assignee: string
  labels: string[]
  cycleId?: string
  startDate?: string
  dueDate?: string
  values: Record<string, CellValue>
  createdAt: string
  updatedAt: string
}

export interface Cycle {
  id: string
  projectId: string
  name: string
  startDate: string
  endDate: string
}

export interface AppData {
  version: 3
  spaces: Space[]
  projects: Project[]
  issues: Issue[]
  cycles: Cycle[]
}
