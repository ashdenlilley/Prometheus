import { createContext, useContext, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react'
import type { AppData, CellValue, Column, Status } from '@shared/types'
import { createIssue, reducer, type Action } from '@shared/model'
import { addDays, todayISO, uid } from './util'

export { createIssue, issueKey, withValue, type Action } from '@shared/model'

const DEFAULT_SPACE_COLOR = '#5e6ad2'

// Upgrades older files. v2 had no spaces: wrap every project in a default space.
function migrate(raw: AppData): AppData {
  if (raw.version === 3) return raw

  const legacy = raw as unknown as AppData & { version: number }
  const spaces = legacy.spaces ?? [{ id: uid(), name: 'Workspace', color: DEFAULT_SPACE_COLOR }]
  const defaultSpaceId = spaces[0].id

  const projects = raw.projects.map(p => {
    const columns: Column[] = p.columns.map(c => {
      const old = c as unknown as { type: string; options?: unknown }
      if (old.type !== 'select') return c
      const labels = Array.isArray(old.options) ? (old.options as string[]) : []
      const options = labels.map((label, n) => ({ id: `opt${n}-${label}`, label, color: '#579bfc' }))
      return { ...c, type: 'dropdown' as const, options }
    })
    return { ...p, spaceId: p.spaceId ?? defaultSpaceId, widths: p.widths ?? {}, columns }
  })

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

  return { version: 3, spaces, projects, issues, cycles: raw.cycles }
}

function seed(): AppData {
  const today = todayISO()
  const spaceId = uid()
  const projectId = uid()
  const estimate = uid()
  const cycleId = uid()
  const base: AppData = {
    version: 3,
    spaces: [{ id: spaceId, name: 'Prometheus', color: DEFAULT_SPACE_COLOR }],
    projects: [
      {
        id: projectId,
        spaceId,
        name: 'Core app',
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

const EMPTY: AppData = { version: 3, spaces: [], projects: [], issues: [], cycles: [] }

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
    // Changes made outside the UI (MCP tools) replace the local copy.
    return window.api.onExternal(next => dispatch({ type: 'load', data: next }))
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
