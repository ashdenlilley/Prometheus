import { PRIORITIES, type CellValue, type Column, type Issue, type IntakeForm, type Project } from './types'

// Fixed issue fields a form can ask for. Other keys must be the id of a project column.
export const FORM_FIXED_KEYS = ['title', 'description', 'priority', 'labels', 'dueDate']

// Column types with no value a person can type into a form.
const UNSUPPORTED = new Set(['formula', 'mirror', 'auto_number', 'created', 'updated', 'button', 'subtasks'])
const LIST_TYPES = new Set(['dropdown', 'label', 'tags', 'people'])
const FIXED_NAMES: Record<string, string> = { title: 'Title', description: 'Description', priority: 'Priority', labels: 'Labels', dueDate: 'Due date' }

// Display name for a field key: the fixed field name, or the column name.
export function fieldName(project: Project, key: string): string {
  return FIXED_NAMES[key] ?? project.columns.find(c => c.id === key)?.name ?? key
}

export function validateForm(form: IntakeForm, project: Project): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const f of form.fields) {
    if (seen.has(f.key)) errors.push(`Duplicate field "${f.key}"`)
    seen.add(f.key)
    if (FORM_FIXED_KEYS.includes(f.key)) continue
    const col = project.columns.find(c => c.id === f.key)
    if (!col) errors.push(`Unknown field "${f.key}"`)
    else if (UNSUPPORTED.has(col.type)) errors.push(`Column "${col.name}" (${col.type}) cannot be filled in a form`)
  }
  if (!seen.has('title')) errors.push('Form needs a Title field')
  return errors
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)

// Stored value for a column answer, in the shape the table cell expects.
function cellValue(col: Column, v: unknown): CellValue {
  if (col.type === 'number') return Number(v)
  if (col.type === 'checkbox') return Boolean(v)
  if (LIST_TYPES.has(col.type)) return (Array.isArray(v) ? v : [v]).map(String)
  return String(v)
}

// Turns an answered form into a triage item. Required fields and the title must be present.
// Labels from the form are added to the answers. Statuses use the project's first unstarted status.
export function submissionToIssue(
  form: IntakeForm,
  project: Project,
  answers: Record<string, unknown>,
  base: { id: string; number: number; now: string }
): { issue?: Issue; errors: string[] } {
  const errors = validateForm(form, project)
  if (errors.length) return { errors }
  const issue: Issue = {
    id: base.id,
    projectId: project.id,
    number: base.number,
    title: '',
    description: '',
    status: project.statuses.find(s => s.category === 'unstarted')?.id ?? project.statuses[0].id,
    priority: 0,
    assignee: '',
    labels: [...(form.labels ?? [])],
    relations: [],
    comments: [],
    activity: [],
    values: {},
    createdAt: base.now,
    updatedAt: base.now,
    triage: true
  }
  for (const f of form.fields) {
    const v = answers[f.key]
    const name = f.label ?? fieldName(project, f.key)
    if (blank(v)) {
      if (f.required || f.key === 'title') errors.push(`${name} is required`)
      continue
    }
    if (f.key === 'title') issue.title = String(v).trim()
    else if (f.key === 'description') issue.description = String(v)
    else if (f.key === 'priority') {
      const p = typeof v === 'string' ? PRIORITIES.indexOf(v) : Number(v)
      if (!Number.isInteger(p) || p < 0 || p > 4) errors.push(`${name} must be 0 (none) to 4 (low)`)
      else issue.priority = p
    } else if (f.key === 'labels') {
      issue.labels = [...new Set([...issue.labels, ...(Array.isArray(v) ? v : String(v).split(',')).map(s => String(s).trim()).filter(Boolean)])]
    } else if (f.key === 'dueDate') issue.dueDate = String(v)
    else issue.values[f.key] = cellValue(project.columns.find(c => c.id === f.key)!, v)
  }
  if (errors.length) return { errors }
  return { issue, errors }
}
