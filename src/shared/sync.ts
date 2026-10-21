import type { AppData } from './types'

// Row-level sync. Every change to AppData becomes ops: put (row JSON) or del, one per row id.
// Ops carry a hybrid logical clock (hlc). Per row, the highest hlc wins (last-writer-wins).
// Pure functions only: no fs, no Electron.

export type Table =
  | 'spaces'
  | 'initiatives'
  | 'projects'
  | 'issues'
  | 'cycles'
  | 'automations'
  | 'triage_rules'
  | 'templates'
  | 'dashboards'
  | 'notifications'

export const TABLE_KEYS: [Table, keyof AppData][] = [
  ['spaces', 'spaces'],
  ['initiatives', 'initiatives'],
  ['projects', 'projects'],
  ['issues', 'issues'],
  ['cycles', 'cycles'],
  ['automations', 'automations'],
  ['triage_rules', 'triageRules'],
  ['templates', 'templates'],
  ['dashboards', 'dashboards'],
  ['notifications', 'notifications']
]

// Op on the wire. `row` absent means delete.
export interface Op {
  hlc: string
  table: Table
  id: string
  row?: unknown
}

// hlc format: 15-digit ms, 6-digit counter, device id. Lexical order equals causal order.
const MS_WIDTH = 15
const CNT_WIDTH = 6

export class Clock {
  private ms = 0
  private cnt = 0

  constructor(private device: string) {}

  setDevice(device: string) {
    this.device = device
  }

  now(): string {
    const wall = Date.now()
    if (wall > this.ms) {
      this.ms = wall
      this.cnt = 0
    } else {
      this.cnt += 1
    }
    return this.format(this.ms, this.cnt)
  }

  // Call with every remote hlc seen, so later local ops sort after it.
  observe(hlc: string) {
    const { ms, cnt } = parse(hlc)
    if (ms > this.ms) {
      this.ms = ms
      this.cnt = cnt
    } else if (ms === this.ms && cnt > this.cnt) {
      this.cnt = cnt
    }
  }

  private format(ms: number, cnt: number) {
    return `${String(ms).padStart(MS_WIDTH, '0')}.${String(cnt).padStart(CNT_WIDTH, '0')}.${this.device}`
  }
}

export function parse(hlc: string): { ms: number; cnt: number } {
  return { ms: Number(hlc.slice(0, MS_WIDTH)), cnt: Number(hlc.slice(MS_WIDTH + 1, MS_WIDTH + 1 + CNT_WIDTH)) }
}

export const clockKey = (table: Table, id: string) => `${table}\u0000${id}`

function rowsOf(data: AppData, key: keyof AppData): { id: string }[] {
  return (data[key] as { id: string }[]) ?? []
}

// Ops that turn `prev` into `next`. Only rows whose JSON changed are emitted.
export function diffOps(prev: AppData, next: AppData, clock: Clock): Op[] {
  const ops: Op[] = []
  for (const [table, key] of TABLE_KEYS) {
    const before = new Map(rowsOf(prev, key).map(r => [r.id, JSON.stringify(r)]))
    const after = new Map(rowsOf(next, key).map(r => [r.id, r]))
    for (const [id, row] of after) {
      if (before.get(id) === JSON.stringify(row)) continue
      ops.push({ hlc: clock.now(), table, id, row })
    }
    for (const id of before.keys()) {
      if (!after.has(id)) ops.push({ hlc: clock.now(), table, id })
    }
  }
  return ops
}

// Returns a new AppData with ops applied in order. Does not check clocks.
export function applyOps(data: AppData, ops: Op[]): AppData {
  const next: AppData = { ...data }
  for (const [table, key] of TABLE_KEYS) {
    const mine = ops.filter(o => o.table === table)
    if (mine.length === 0) continue
    const rows = new Map(rowsOf(data, key).map(r => [r.id, r]))
    for (const op of mine) {
      if (op.row === undefined) rows.delete(op.id)
      else rows.set(op.id, op.row as { id: string })
    }
    ;(next as unknown as Record<string, unknown>)[key] = [...rows.values()]
  }
  return next
}
