import { createContext, useContext, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react'
import type { AppData } from '@shared/types'
import { reducer, type Action } from '@shared/model'
import { emptyHistory, withUndo, type HistoryAction } from '@shared/history'
import { emptyData } from '@shared/seed'
import { todayISO } from './util'

export { createIssue, issueKey, withValue, categoryOf, statusLabel, type Action } from '@shared/model'

interface Store {
  data: AppData
  dispatch: Dispatch<Action>
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

const StoreContext = createContext<Store | null>(null)
const undoable = withUndo(reducer)

// Data is owned by the main process (SQLite). The renderer keeps a working copy and saves it back.
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatchAll] = useReducer(undoable, undefined, () => ({ data: emptyData(), history: emptyHistory() }))
  const { data, history } = state
  const dispatch = dispatchAll as Dispatch<HistoryAction>
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
    const tick = () => {
      dispatch({ type: 'tick', today: todayISO() })
      dispatch({ type: 'autoRollOver', today: todayISO() })
      dispatch({ type: 'markRolledOver', today: todayISO() })
    }
    const timer = setInterval(tick, 60_000)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    dispatch({ type: 'tick', today: todayISO() })
    dispatch({ type: 'autoRollOver', today: todayISO() })
    dispatch({ type: 'markRolledOver', today: todayISO() })
  }, [ready])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => window.api.save(data), 200)
    return () => clearTimeout(timer)
  }, [data, ready])

  // Posts queued by this window's own changes are sent from here. Changes from sync never carry posts.
  useEffect(() => {
    if (!ready || !data.pendingPosts?.length) return
    const posts = data.pendingPosts
    // Save first, so the main process finds the change that queued each post
    window.api.save(data)
    window.api.integrations.post(posts)
    dispatch({ type: 'clearPendingPosts', ids: posts.map(p => p.id) })
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
  const value: Store = {
    data,
    dispatch,
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0
  }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
