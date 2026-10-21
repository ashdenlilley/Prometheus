import { createContext, useContext, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react'
import type { AppData, CellValue, Cycle, Issue, Project, Status } from '@shared/types'
import { addDays, todayISO, uid } from './util'

export type Action =
  | { type: 'load'; data: AppData }
  | { type: 'addProject'; project: Project }
  | { type: 'patchProject'; id: string; patch: Partial<Project> }
  | { type: 'deleteProject'; id: string }
  | { type: 'deleteColumn'; projectId: string; columnId: string }
  | { type: 'addIssue'; issue: Issue }
  | { type: 'patchIssue'; id: string; patch: Partial<Issue> }
  | { type: 'deleteIssue'; id: string }
  | { type: 'addCycle'; cycle: Cycle }
  | { type: 'patchCycle'; id: string; patch: Partial<Cycle> }
  | { type: 'deleteCycle'; id: string }

export function reducer(s: AppData, a: Action): AppData {
  switch (a.type) {
    case 'load':
      return a.data
    case 'addProject':
      return { ...s, projects: [...s.projects, a.project] }
    case 'patchProject':
      return { ...s, projects: s.projects.map(p => (p.id === a.id ? { ...p, ...a.patch } : p)) }
    case 'deleteProject':
      return {
        ...s,
        projects: s.projects.filter(p => p.id !== a.id),
        issues: s.issues.filter(i => i.projectId !== a.id),
        cycles: s.cycles.filter(c => c.projectId !== a.id)
      }
    case 'deleteColumn':
      return {
        ...s,
        projects: s.projects.map(p =>
          p.id === a.projectId ? { ...p, columns: p.columns.filter(c => c.id !== a.columnId) } : p
        ),
        issues: s.issues.map(i => {
          if (i.projectId !== a.projectId) return i
          const values = { ...i.values }
          delete values[a.columnId]
          return { ...i, values }
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

function seed(): AppData {
  const today = todayISO()
  const projectId = uid()
  const estimate = uid()
  const cycleId = uid()
  const base: AppData = {
    version: 1,
    projects: [
      {
        id: projectId,
        name: 'Prometheus',
        key: 'PRM',
        color: '#5e6ad2',
        startDate: today,
        targetDate: addDays(today, 60),
        columns: [{ id: estimate, name: 'Estimate', type: 'number' }]
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

const EMPTY: AppData = { version: 1, projects: [], issues: [], cycles: [] }

const StoreContext = createContext<{ data: AppData; dispatch: Dispatch<Action> } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(reducer, EMPTY)
  const [ready, setReady] = useState(false)
  const latest = useRef(data)
  latest.current = data

  useEffect(() => {
    window.api.load().then(loaded => {
      dispatch({ type: 'load', data: loaded ?? seed() })
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
