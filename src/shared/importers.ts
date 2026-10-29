import { parseCSV } from './query'
import type { Issue, Project } from './types'

// Jira and Asana export files, read into one row shape. extId is the id in the source file.
export interface ImportRow {
  extId: string
  title: string
  description?: string
  status?: string
  priority?: number
  assignee?: string
  labels: string[]
  dueDate?: string
  estimate?: number
  parentExtId?: string
  done?: boolean
}

// Jira priority names to the app's priority index (1 urgent ... 4 low, 0 none).
export function mapPriority(s: string): number {
  const v = s.trim().toLowerCase()
  if (['highest', 'blocker', 'critical'].includes(v)) return 1
  if (v === 'high') return 2
  if (v === 'medium') return 3
  if (['low', 'lowest'].includes(v)) return 4
  return 0
}

// Header name to column index. Returns -1 when the header is missing.
const colOf = (header: string[], ...names: string[]) => {
  for (const name of names) {
    const at = header.findIndex(h => h.trim().toLowerCase() === name.toLowerCase())
    if (at >= 0) return at
  }
  return -1
}

const cell = (r: string[], at: number) => (at >= 0 ? (r[at] ?? '').trim() : '')

const isDone = (status: string) => /^(done|closed|resolved)$/i.test(status)

export function parseJiraCsv(text: string): ImportRow[] {
  const [header = [], ...body] = parseCSV(text)
  // Jira repeats the Labels header once per label, so every Labels column is read.
  const labelAts = header.flatMap((h, n) => (h.trim().toLowerCase() === 'labels' ? [n] : []))
  const at = {
    key: colOf(header, 'Issue key'),
    id: colOf(header, 'Issue id'),
    parent: colOf(header, 'Parent id', 'Parent'),
    summary: colOf(header, 'Summary'),
    status: colOf(header, 'Status'),
    priority: colOf(header, 'Priority'),
    assignee: colOf(header, 'Assignee'),
    due: colOf(header, 'Due date'),
    points: colOf(header, 'Story Points', 'Custom field (Story Points)'),
    description: colOf(header, 'Description')
  }
  return body
    .map(r => {
      const status = cell(r, at.status)
      const points = Number(cell(r, at.points))
      return {
        extId: cell(r, at.id) || cell(r, at.key),
        title: cell(r, at.summary),
        description: cell(r, at.description) || undefined,
        status: status || undefined,
        priority: mapPriority(cell(r, at.priority)),
        assignee: cell(r, at.assignee) || undefined,
        labels: labelAts.map(n => cell(r, n)).filter(Boolean),
        dueDate: cell(r, at.due) || undefined,
        estimate: cell(r, at.points) && Number.isFinite(points) ? points : undefined,
        parentExtId: cell(r, at.parent) || undefined,
        done: isDone(status)
      }
    })
    .filter(r => r.title)
}

export function parseAsanaCsv(text: string): ImportRow[] {
  const [header = [], ...body] = parseCSV(text)
  const at = {
    id: colOf(header, 'Task ID'),
    name: colOf(header, 'Name'),
    section: colOf(header, 'Section/Column'),
    assignee: colOf(header, 'Assignee'),
    due: colOf(header, 'Due Date'),
    tags: colOf(header, 'Tags'),
    notes: colOf(header, 'Notes'),
    parent: colOf(header, 'Parent task'),
    completed: colOf(header, 'Completed At')
  }
  const rows = body.map(r => ({ r, title: cell(r, at.name) })).filter(x => x.title)
  // Asana CSV names the parent task rather than giving its id, so resolve the name to a row's Task ID.
  const idByName = new Map<string, string>()
  for (const { r, title } of rows) if (!idByName.has(title)) idByName.set(title, cell(r, at.id))
  return rows.map(({ r, title }) => {
    const parentName = cell(r, at.parent)
    return {
      extId: cell(r, at.id),
      title,
      description: cell(r, at.notes) || undefined,
      status: cell(r, at.section) || undefined,
      assignee: cell(r, at.assignee) || undefined,
      labels: cell(r, at.tags)
        .split(',')
        .map(t => t.trim())
        .filter(Boolean),
      dueDate: cell(r, at.due) || undefined,
      parentExtId: parentName ? idByName.get(parentName) : undefined,
      done: cell(r, at.completed) !== ''
    }
  })
}

interface AsanaTask {
  gid: string
  name?: string
  notes?: string
  assignee?: { name?: string } | null
  due_on?: string | null
  completed?: boolean
  tags?: { name: string }[]
  parent?: { gid: string } | null
  memberships?: { section?: { name?: string } }[]
}

export function parseAsanaJson(text: string): ImportRow[] {
  const data = (JSON.parse(text).data ?? []) as AsanaTask[]
  return data
    .filter(t => t.name)
    .map(t => ({
      extId: t.gid,
      title: t.name ?? '',
      description: t.notes || undefined,
      status: t.memberships?.[0]?.section?.name || undefined,
      assignee: t.assignee?.name || undefined,
      labels: (t.tags ?? []).map(g => g.name),
      dueDate: t.due_on || undefined,
      parentExtId: t.parent?.gid || undefined,
      done: !!t.completed
    }))
}

// Status names in the rows that do not match a status label in the project (case-insensitive).
export function unknownStatuses(rows: ImportRow[], project: Project): string[] {
  const labels = new Set(project.statuses.map(s => s.label.toLowerCase()))
  const out = new Set<string>()
  for (const r of rows) if (r.status && !labels.has(r.status.toLowerCase())) out.add(r.status)
  return [...out]
}

// Rows to new issues. statusMap maps a row's status name to a project status id.
// Without a mapping: a matching label, else the first completed status for done rows, else the first unstarted one.
// Parent links resolve through extId; a parent missing from the rows is dropped.
export function buildImport(
  rows: ImportRow[],
  project: Project,
  statusMap: Record<string, string>,
  base: { newId: () => string; startNumber: number; now: string }
): Issue[] {
  const newIds = rows.map(() => base.newId())
  const ids = new Map(rows.map((r, n) => [r.extId, newIds[n]]))
  const firstOf = (category: string) => project.statuses.find(s => s.category === category)?.id
  return rows.map((r, n) => {
    const byLabel = project.statuses.find(s => s.label.toLowerCase() === (r.status ?? '').toLowerCase())?.id
    const status = (r.status && statusMap[r.status]) || byLabel || (r.done ? firstOf('completed') : firstOf('unstarted')) || project.statuses[0].id
    return {
      id: newIds[n],
      projectId: project.id,
      number: base.startNumber + n,
      title: r.title,
      description: r.description ?? '',
      status,
      priority: r.priority ?? 0,
      assignee: r.assignee ?? '',
      labels: r.labels,
      dueDate: r.dueDate,
      estimate: r.estimate,
      parentId: r.parentExtId ? ids.get(r.parentExtId) : undefined,
      relations: [],
      comments: [],
      activity: [],
      values: {},
      createdAt: base.now,
      updatedAt: base.now
    }
  })
}
