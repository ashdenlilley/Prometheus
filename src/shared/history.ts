import type { AppData } from './types'
import type { Action } from './model'

// Undo/redo for the renderer's working copy.
//
// Each undoable action is stored as a row-level patch: the rows it changed, with their value before
// and after (by id, per collection). Undo writes the "before" rows back onto the *current* data, and
// redo writes the "after" rows. Rows the action did not touch are left alone, so changes that arrived
// in between (MCP tools, sync) survive an undo. The result goes through the normal save path, so an
// undo is saved and synced like any other edit.

export const COLLECTIONS = [
  'spaces',
  'initiatives',
  'projects',
  'issues',
  'cycles',
  'automations',
  'triageRules',
  'templates',
  'dashboards',
  'docs',
  'agents',
  'webhooks',
  'gitLinks',
  'integrations'
] as const
// Notifications are left out: they are a feed, not user data.
export type Collection = (typeof COLLECTIONS)[number]

type Row = { id: string }

export interface RowChange {
  collection: Collection
  id: string
  before?: Row
  beforeIndex?: number
  after?: Row
  afterIndex?: number
}

export interface Patch {
  rows: RowChange[]
  me?: { before: string; after: string }
}

const rowsOf = (d: AppData, c: Collection) => (d[c] ?? []) as unknown as Row[]

/** The rows that differ between two versions of the data. Unchanged rows keep their reference in the reducer. */
export function diffData(prev: AppData, next: AppData): Patch {
  const rows: RowChange[] = []
  for (const c of COLLECTIONS) {
    const a = rowsOf(prev, c)
    const b = rowsOf(next, c)
    if (a === b) continue
    const aIdx = new Map(a.map((r, i) => [r.id, i]))
    const bIdx = new Map(b.map((r, i) => [r.id, i]))
    for (const [id, i] of aIdx) {
      const j = bIdx.get(id)
      if (j === undefined) rows.push({ collection: c, id, before: a[i], beforeIndex: i })
      else if (a[i] !== b[j] && JSON.stringify(a[i]) !== JSON.stringify(b[j])) {
        rows.push({ collection: c, id, before: a[i], beforeIndex: i, after: b[j], afterIndex: j })
      }
    }
    for (const [id, j] of bIdx) if (!aIdx.has(id)) rows.push({ collection: c, id, after: b[j], afterIndex: j })
  }
  const patch: Patch = { rows }
  if (prev.me !== next.me) patch.me = { before: prev.me, after: next.me }
  return patch
}

export const isEmpty = (p: Patch) => p.rows.length === 0 && !p.me

/** Writes one side of a patch onto the data: 'before' undoes it, 'after' redoes it. */
export function applyPatch(data: AppData, patch: Patch, side: 'before' | 'after'): AppData {
  const out: AppData = { ...data }
  const touched = new Map<Collection, Row[]>()
  for (const ch of patch.rows) {
    const list = touched.get(ch.collection) ?? [...rowsOf(data, ch.collection)]
    touched.set(ch.collection, list)
    const row = ch[side]
    const index = side === 'before' ? ch.beforeIndex : ch.afterIndex
    const at = list.findIndex(r => r.id === ch.id)
    if (!row) {
      if (at >= 0) list.splice(at, 1)
    } else if (at >= 0) {
      list[at] = row
    } else {
      list.splice(Math.min(index ?? list.length, list.length), 0, row)
    }
  }
  for (const [c, list] of touched) (out as unknown as Record<Collection, Row[]>)[c] = list
  if (patch.me) out.me = patch.me[side]
  return out
}

/** Combines two consecutive patches into one: the earliest "before" and the latest "after" of each row. */
export function mergePatches(first: Patch, second: Patch): Patch {
  const byKey = new Map<string, RowChange>()
  for (const ch of first.rows) byKey.set(`${ch.collection}:${ch.id}`, { ...ch })
  for (const ch of second.rows) {
    const key = `${ch.collection}:${ch.id}`
    const prev = byKey.get(key)
    if (!prev) byKey.set(key, { ...ch })
    else byKey.set(key, { ...prev, after: ch.after, afterIndex: ch.afterIndex })
  }
  // Rows created and then deleted again, or edited back to where they started, cancel out.
  const rows = [...byKey.values()].filter(
    ch => (ch.before || ch.after) && !(ch.before && ch.after && JSON.stringify(ch.before) === JSON.stringify(ch.after))
  )
  const me = first.me && second.me ? { before: first.me.before, after: second.me.after } : (second.me ?? first.me)
  const out: Patch = { rows }
  if (me && me.before !== me.after) out.me = me
  return out
}

// ───────────── History state ─────────────

export interface History {
  past: Patch[]
  future: Patch[]
  // What the last entry was, so rapid edits to the same field (typing a title) become one undo step.
  lastKey: string | null
  lastAt: number
}

export interface WithHistory {
  data: AppData
  history: History
}

export type HistoryAction = Action | { type: 'undo' } | { type: 'redo' }

export const emptyHistory = (): History => ({ past: [], future: [], lastKey: null, lastAt: 0 })

// Not undoable: loads (startup, MCP or sync replacing the copy), timed automations, the roll-over bookkeeping flag
// and the notification feed.
const NOT_UNDOABLE = new Set<Action['type']>([
  'load',
  'tick',
  'markRolledOver',
  'notify',
  'markNotifications',
  'shareToSlack', // queues a post that has already gone out; undo cannot unsend it
  'clearPendingPosts'
])

export const LIMIT = 100
// Edits with the same key this close together merge, e.g. one keystroke per patchIssue while typing a title.
export const COALESCE_MS = 1000
// Any actions this close together are treated as one gesture (a handler that dispatches twice).
export const GESTURE_MS = 50

/** Key used to merge rapid edits of the same thing. Null means never merge on key. */
export function coalesceKey(a: Action): string | null {
  const fields = (patch: object) => Object.keys(patch).sort().join(',')
  switch (a.type) {
    case 'patchIssue':
    case 'patchProject':
    case 'patchSpace':
    case 'patchInitiative':
    case 'patchCycle':
    case 'patchAutomation':
    case 'patchTriageRule':
    case 'patchDashboard':
      return `${a.type}:${a.id}:${fields(a.patch)}`
    case 'patchColumn':
      return `${a.type}:${a.projectId}:${a.columnId}:${fields(a.patch)}`
    default:
      return null
  }
}

/** Wraps the app reducer with undo/redo. `now` is injectable for tests. */
export function withUndo(
  reducer: (s: AppData, a: Action) => AppData,
  now: () => number = Date.now
): (s: WithHistory, a: HistoryAction) => WithHistory {
  return (state, action) => {
    const { data, history } = state
    if (action.type === 'undo' || action.type === 'redo') {
      const from = action.type === 'undo' ? history.past : history.future
      const entry = from[from.length - 1]
      if (!entry) return state
      const rest = from.slice(0, -1)
      const next = applyPatch(data, entry, action.type === 'undo' ? 'before' : 'after')
      return {
        data: next,
        history:
          action.type === 'undo'
            ? { past: rest, future: [...history.future, entry], lastKey: null, lastAt: 0 }
            : { past: [...history.past, entry], future: rest, lastKey: null, lastAt: 0 }
      }
    }

    const next = reducer(data, action)
    if (next === data || NOT_UNDOABLE.has(action.type)) return { data: next, history }
    const patch = diffData(data, next)
    if (isEmpty(patch)) return { data: next, history }

    const at = now()
    const key = coalesceKey(action)
    const last = history.past[history.past.length - 1]
    const merge =
      last && (at - history.lastAt < GESTURE_MS || (key !== null && key === history.lastKey && at - history.lastAt < COALESCE_MS))
    let past: Patch[]
    if (merge) {
      // Typing a value and then deleting it again leaves nothing to undo.
      const merged = mergePatches(last, patch)
      past = isEmpty(merged) ? history.past.slice(0, -1) : [...history.past.slice(0, -1), merged]
    } else past = [...history.past, patch]
    return {
      data: next,
      history: { past: past.slice(-LIMIT), future: [], lastKey: key, lastAt: at }
    }
  }
}
