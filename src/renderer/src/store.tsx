import { createContext, useContext, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react'
import type { AppData, CellValue, Column, Cycle, Issue, Project, Status } from '@shared/types'
import { addDays, todayISO, uid } from './util'

export type Action =
  | { type: 'load'; data: AppData }
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
    id: uid(),
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

// Upgrades data written by earlier versions: old 'select' columns became
// dropdown/status options with ids, and projects gained column widths.
function migrate(raw: AppData): AppData {
  const projects = raw.projects.map(p => ({
    ...p,
    widths: p.widths ?? {},
    columns: p.columns.map(c => {
      const legacy = c as unknown as { type: string; options?: unknown }
      if (legacy.type !== 'select') return c
      const labels = Array.isArray(legacy.options) ? (legacy.options as string[]) : []
      const options = labels.map((label, n) => ({ id: `opt${n}-${label}`, label, color: '#579bfc' }))
      return { ...c, type: 'dropdown' as const, options }
    })
  }))

  // Legacy select values stored the label; dropdown values now store the option id.
  const issues = raw.issues.map(i => {
    const project = projects.find(p => p.id === i.projectId)
    if (!project) return i
    const values = Object.fromEntries(
      Object.entries(i.values).map(([colId, v]) => {
        const col = project.columns.find(c => c.id === colId)
        if (col?.type === 'dropdown' && typeof v === 'string') {
          return [colId, col.options?.find(o => o.label === v)?.id ?? v]
        }
        return [colId, v]
      })
    )
    return { ...i, values }
  })

  return { version: 2, projects, issues, cycles: raw.cycles }
}

function seed(): AppData {
  const today = todayISO()
  const projectId = uid()
  const estimate = uid()
  const cycleId = uid()
  const base: AppData = {
    version: 2,
    projects: [
      {
        id: projectId,
        name: 'Prometheus',
        key: 'PRM',
        color: '#5e6ad2',
        startDate: today,
        targetDate: addDays(today, 60),
        columns: [{ id: estimate, name: 'Estimate', type: 'number' }],
        widths: {}
      }
    ],
    issues: [],
    cycles: [{ id: cycleId, projectId, name: 'Cycle 1', startDate: today, endDate: addDays(today, 13) }]
  }
  const samples: [string, Status, number][] = [
    ['Set up project structure', 'done', 2],
    ['Build board view', 'in_progress', 5],
    ['Timeline bar resizing', 'todo', 3],
    ['Roadmap export', 'backlog', 8]
  ]
  return samples.reduce<AppData>(
    (data, [title, status, est], n) => ({
      ...data,
      issues: [
        ...data.issues,
        createIssue(data, projectId, title, {
          status,
          values: { [estimate]: est },
          cycleId: n < 3 ? cycleId : undefined,
          startDate: addDays(today, n),
          dueDate: addDays(today, n + 6),
          priority: n === 1 ? 1 : 0
        })
      ]
    }),
    base
  )
}

const EMPTY: AppData = { version: 2, projects: [], issues: [], cycles: [] }

const StoreContext = createContext<{ data: AppData; dispatch: Dispatch<Action> } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(reducer, EMPTY)
  const [ready, setReady] = useState(false)
  const latest = useRef(data)
  latest.current = data

  useEffect(() => {
    window.api.load().then(loaded => {
      dispatch({ type: 'load', data: loaded ? migrate(loaded) : seed() })
      setReady(true)
    })
  }, [])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => window.api.save(data), 200)
    return () => clearTimeout(timer)
  }, [data, ready])

  // Flush the pending change when the window closes.
  useEffect(() => {
    const flush = () => {
      if (ready) window.api.save(latest.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [ready])

  if (!ready) return null
  return <StoreContext.Provider value={{ data, dispatch }}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
