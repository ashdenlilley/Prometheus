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

export type ColumnType = 'text' | 'number' | 'date' | 'checkbox' | 'select'

export type CellValue = string | number | boolean

export interface Column {
  id: string
  name: string
  type: ColumnType
  options?: string[]
}

export interface Project {
  id: string
  name: string
  key: string
  color: string
  startDate?: string
  targetDate?: string
  columns: Column[]
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
  version: 1
  projects: Project[]
  issues: Issue[]
  cycles: Cycle[]
}
