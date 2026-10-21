import { createContext, useContext, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react'
import type { AppData } from '@shared/types'
import { reducer, type Action } from '@shared/model'
import { emptyData } from '@shared/seed'
import { todayISO } from './util'

export { createIssue, issueKey, withValue, categoryOf, statusLabel, type Action } from '@shared/model'

const StoreContext = createContext<{ data: AppData; dispatch: Dispatch<Action> } | null>(null)

// Data is owned by the main process (SQLite). The renderer keeps a working copy and saves it back.
export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(reducer, emptyData())
  const [ready, setReady] = useState(false)
  const latest = useRef(data)
  latest.current = data

  useEffect(() => {
    window.api.load().then(loaded => {
      if (loaded) dispatch({ type: 'load', data: loaded })
      setReady(true)
    })
    // Changes made outside the UI (MCP tools) replace the local copy.
    const unsubscribe = window.api.onExternal(next => dispatch({ type: 'load', data: next }))
    // Timed automations (due date passed) are checked on load and once a minute.
    const tick = () => dispatch({ type: 'tick', today: todayISO() })
    const timer = setInterval(tick, 60_000)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (ready) dispatch({ type: 'tick', today: todayISO() })
  }, [ready])

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
