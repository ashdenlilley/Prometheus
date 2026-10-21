import type { AppData, CellValue, Column, Cycle, Issue, Project, Space } from './types'

// Pure data layer shared by the renderer (UI actions) and the main process (MCP tools).

export type Action =
  | { type: 'load'; data: AppData }
  | { type: 'addSpace'; space: Space }
  | { type: 'patchSpace'; id: string; patch: Partial<Space> }
  | { type: 'deleteSpace'; id: string }
  | { type: 'addProject'; project: Project }
  | { type: 'patchProject'; id: string; patch: Partial<Project> }
  | { type: 'deleteProject'; id: string }
  | { type: 'addColumn'; projectId: string; column: Column }
  | { type: 'patchColumn'; projectId: string; columnId: string; patch: Partial<Column> }
  | { type: 'deleteColumn'; projectId: string; columnId: string }
  | { type: 'addIssue'; issue: Issue }
  | { type: 'patchIssue'; id: string; patch: Partial<Issue> }
  | { type: 'deleteIssue'; id: string }
  | { type: 'addCycle'; cycle: Cycle }
  | { type: 'patchCycle'; id: string; patch: Partial<Cycle> }
  | { type: 'deleteCycle'; id: string }

const mapProject = (s: AppData, id: string, fn: (p: Project) => Project): AppData => ({
  ...s,
  projects: s.projects.map(p => (p.id === id ? fn(p) : p))
})

export function reducer(s: AppData, a: Action): AppData {
  switch (a.type) {
    case 'load':
      return a.data
    case 'addSpace':
      return { ...s, spaces: [...s.spaces, a.space] }
    case 'patchSpace':
      return { ...s, spaces: s.spaces.map(sp => (sp.id === a.id ? { ...sp, ...a.patch } : sp)) }
    case 'deleteSpace': {
      const projectIds = s.projects.filter(p => p.spaceId === a.id).map(p => p.id)
      return {
        ...s,
        spaces: s.spaces.filter(sp => sp.id !== a.id),
        projects: s.projects.filter(p => p.spaceId !== a.id),
        issues: s.issues.filter(i => !projectIds.includes(i.projectId)),
        cycles: s.cycles.filter(c => !projectIds.includes(c.projectId))
      }
    }
    case 'addProject':
      return { ...s, projects: [...s.projects, a.project] }
    case 'patchProject':
      return mapProject(s, a.id, p => ({ ...p, ...a.patch }))
    case 'deleteProject':
      return {
        ...s,
        projects: s.projects.filter(p => p.id !== a.id),
        issues: s.issues.filter(i => i.projectId !== a.id),
        cycles: s.cycles.filter(c => c.projectId !== a.id)
      }
    case 'addColumn':
      return mapProject(s, a.projectId, p => ({ ...p, columns: [...p.columns, a.column] }))
    case 'patchColumn':
      return mapProject(s, a.projectId, p => ({
        ...p,
        columns: p.columns.map(c => (c.id === a.columnId ? { ...c, ...a.patch } : c))
      }))
    case 'deleteColumn':
      return {
        ...mapProject(s, a.projectId, p => ({ ...p, columns: p.columns.filter(c => c.id !== a.columnId) })),
        issues: s.issues.map(i => {
          if (i.projectId !== a.projectId) return i
          return { ...i, values: withValue(i.values, a.columnId, undefined) }
        })
      }
    case 'addIssue':
      return { ...s, issues: [...s.issues, a.issue] }
    case 'patchIssue':
      return {
        ...s,
        issues: s.issues.map(i =>
          i.id === a.id ? { ...i, ...a.patch, updatedAt: new Date().toISOString() } : i
        )
      }
    case 'deleteIssue':
      return { ...s, issues: s.issues.filter(i => i.id !== a.id) }
    case 'addCycle':
      return { ...s, cycles: [...s.cycles, a.cycle] }
    case 'patchCycle':
      return { ...s, cycles: s.cycles.map(c => (c.id === a.id ? { ...c, ...a.patch } : c)) }
    case 'deleteCycle':
      return {
        ...s,
        cycles: s.cycles.filter(c => c.id !== a.id),
        issues: s.issues.map(i => (i.cycleId === a.id ? { ...i, cycleId: undefined } : i))
      }
  }
}

export function createIssue(data: AppData, projectId: string, title: string, patch: Partial<Issue> = {}): Issue {
  const now = new Date().toISOString()
  const number = data.issues.filter(i => i.projectId === projectId).reduce((m, i) => Math.max(m, i.number), 0) + 1
  return {
    id: crypto.randomUUID(),
    projectId,
    number,
    title,
    description: '',
    status: 'backlog',
    priority: 0,
    assignee: '',
    labels: [],
    values: {},
    createdAt: now,
    updatedAt: now,
    ...patch
  }
}

export function issueKey(data: AppData, issue: Issue) {
  const project = data.projects.find(p => p.id === issue.projectId)
  return `${project?.key ?? 'ISS'}-${issue.number}`
}

export function withValue(values: Issue['values'], id: string, v: CellValue | undefined): Issue['values'] {
  const next = { ...values }
  if (v === undefined) delete next[id]
  else next[id] = v
  return next
}
