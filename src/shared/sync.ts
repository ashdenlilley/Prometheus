import type { AppData, Project, SavedView } from './types'

// Row-level sync with per-field clocks. Pure functions only: no fs, no Electron.
//
// An op is one of:
//   create  { create: true, set: row }   row appeared (carries every field)
//   set     { set: {field: value}, unset?: [field] }   fields changed on an existing row
//   del     { del: true }                row removed
//
// Every op has an hlc. Clocks are kept per (table, id, field), plus '$' for row existence.
// A value wins when its hlc is greater than the stored clock for that key. This is per-field
// last-writer-wins: two devices editing different fields of one row both keep their edits.

export type Table =
  | 'spaces'
  | 'initiatives'
  | 'teams'
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
  ['teams', 'teams'],
  ['projects', 'projects'],
  ['issues', 'issues'],
  ['cycles', 'cycles'],
  ['automations', 'automations'],
  ['triage_rules', 'triageRules'],
  ['templates', 'templates'],
  ['dashboards', 'dashboards'],
  ['notifications', 'notifications']
]

export interface Op {
  hlc: string
  table: Table
  id: string
  create?: boolean
  del?: boolean
  set?: Record<string, unknown>
  unset?: string[]
}

// Row existence clock key. Field names never contain '$'.
const EXISTS = '$'

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

  // Call with every remote hlc accepted, so later local ops sort after it.
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

// Lowest possible hlc. Used for data that predates sync, so any real edit beats it.
export const ZERO_HLC = `${'0'.repeat(MS_WIDTH)}.${'0'.repeat(CNT_WIDTH)}.`

const sep = '\u0000'
const rowKey = (table: Table, id: string, field: string) => `${table}${sep}${id}${sep}${field}`

// Clock keys an op touches.
export function opKeys(op: Op): string[] {
  if (op.del) return [rowKey(op.table, op.id, EXISTS)]
  if (op.create) return [rowKey(op.table, op.id, EXISTS), ...Object.keys(op.set ?? {}).map(f => rowKey(op.table, op.id, f))]
  return [...Object.keys(op.set ?? {}), ...(op.unset ?? [])].map(f => rowKey(op.table, op.id, f))
}

// Records local ops in the clock map. Returns [key, hlc] pairs for persistence.
export function stampOps(clocks: Map<string, string>, ops: Op[]): [string, string][] {
  const entries: [string, string][] = []
  for (const op of ops) {
    for (const k of opKeys(op)) {
      clocks.set(k, op.hlc)
      entries.push([k, op.hlc])
    }
  }
  return entries
}

// Personal views stay on this device, so they never go out in project rows.
export const stripPersonal = (project: Project): Project => ({ ...project, views: project.views.filter(v => !v.personal) })

// Incoming shared views, plus this device's personal views from `local`.
export const keepPersonal = (local: SavedView[], incoming: SavedView[]): SavedView[] => [
  ...incoming.filter(v => !v.personal),
  ...local.filter(v => v.personal)
]

// `data` with each project's personal views taken from `from` (the renderer's copy). Personal views produce
// no ops, so the main process adopts them directly. Returns `data` itself when nothing differs.
export function adoptPersonal(data: AppData, from: AppData): AppData {
  const mine = new Map(from.projects.map(p => [p.id, p.views.filter(v => v.personal)]))
  let changed = false
  const projects = data.projects.map(p => {
    const personal = mine.get(p.id) ?? []
    if (JSON.stringify(p.views.filter(v => v.personal)) === JSON.stringify(personal)) return p
    changed = true
    return { ...p, views: [...p.views.filter(v => !v.personal), ...personal] }
  })
  return changed ? { ...data, projects } : data
}

// A row as it goes out to other devices.
const outgoing = (table: Table, r: { id: string }) =>
  (table === 'projects' ? stripPersonal(r as unknown as Project) : r) as unknown as Record<string, unknown>

// Ops that turn `prev` into `next`, one op per changed row, carrying only changed fields.
export function diffOps(prev: AppData, next: AppData, clock: Clock): Op[] {
  const ops: Op[] = []
  for (const [table, key] of TABLE_KEYS) {
    const before = new Map((prev[key] as { id: string }[]).map(r => [r.id, outgoing(table, r)]))
    const after = new Map((next[key] as { id: string }[]).map(r => [r.id, outgoing(table, r)]))
    for (const [id, row] of after) {
      const old = before.get(id)
      if (!old) {
        ops.push({ hlc: clock.now(), table, id, create: true, set: { ...row } })
        continue
      }
      const set: Record<string, unknown> = {}
      const unset: string[] = []
      for (const f of Object.keys(row)) {
        if (JSON.stringify(old[f]) !== JSON.stringify(row[f])) set[f] = row[f]
      }
      for (const f of Object.keys(old)) if (!(f in row)) unset.push(f)
      if (Object.keys(set).length === 0 && unset.length === 0) continue
      ops.push({ hlc: clock.now(), table, id, set, ...(unset.length ? { unset } : {}) })
    }
    for (const id of before.keys()) {
      if (!after.has(id)) ops.push({ hlc: clock.now(), table, id, del: true })
    }
  }
  return ops
}

type Rows = Map<string, Record<string, unknown>>

// Applies ops to `data`. With `clocks`, an op or field applies only if its hlc beats the stored
// clock, and the clock map is updated. Without `clocks`, every op applies (local edits).
// Returns the new data and the number of ops that changed something.
export function applyOps(data: AppData, ops: Op[], clocks?: Map<string, string>): { data: AppData; applied: number } {
  const next: AppData = { ...data }
  let applied = 0
  for (const [table, key] of TABLE_KEYS) {
    const mine = ops.filter(o => o.table === table)
    if (mine.length === 0) continue
    const rows: Rows = new Map((data[key] as { id: string }[]).map(r => [r.id, { ...(r as unknown as Record<string, unknown>) }]))
    const wins = (k: string, hlc: string) => {
      const cur = clocks?.get(k)
      return !clocks || cur === undefined || cur < hlc
    }
    const stamp = (k: string, hlc: string) => clocks?.set(k, hlc)

    for (const op of mine) {
      if (op.del) {
        if (!wins(rowKey(table, op.id, EXISTS), op.hlc)) continue
        stamp(rowKey(table, op.id, EXISTS), op.hlc)
        if (rows.delete(op.id)) applied++
        continue
      }
      if (op.create) {
        if (!wins(rowKey(table, op.id, EXISTS), op.hlc)) continue
        stamp(rowKey(table, op.id, EXISTS), op.hlc)
        const row: Record<string, unknown> = {}
        for (const [f, v] of Object.entries(op.set ?? {})) {
          if (wins(rowKey(table, op.id, f), op.hlc)) {
            row[f] = v
            stamp(rowKey(table, op.id, f), op.hlc)
          }
        }
        rows.set(op.id, row)
        applied++
        continue
      }
      // Field ops need the row to exist. A deleted row ignores late field edits.
      const row = rows.get(op.id)
      if (!row) continue
      let touched = false
      for (const [f, v] of Object.entries(op.set ?? {})) {
        if (!wins(rowKey(table, op.id, f), op.hlc)) continue
        stamp(rowKey(table, op.id, f), op.hlc)
        row[f] = table === 'projects' && f === 'views' ? keepPersonal(row.views as SavedView[], v as SavedView[]) : v
        touched = true
      }
      for (const f of op.unset ?? []) {
        if (!wins(rowKey(table, op.id, f), op.hlc)) continue
        stamp(rowKey(table, op.id, f), op.hlc)
        delete row[f]
        touched = true
      }
      if (touched) applied++
    }
    ;(next as unknown as Record<string, unknown>)[key] = [...rows.values()]
  }
  return { data: next, applied }
}

// Full state as ops, each field stamped with its winning clock. Replaying these on any device
// yields the same rows as the segments they replace, so old segments can be deleted after.
export function snapshotOps(data: AppData, clocks: Map<string, string>, device: string): Op[] {
  const ops: Op[] = []
  const live = new Set<string>()
  for (const [table, key] of TABLE_KEYS) {
    for (const r of data[key] as { id: string }[]) {
      const row = outgoing(table, r)
      live.add(rowKey(table, r.id, EXISTS))
      const existsHlc = clocks.get(rowKey(table, r.id, EXISTS)) ?? ZERO_HLC + device
      ops.push({ hlc: existsHlc, table, id: r.id, create: true, set: {} })
      for (const f of Object.keys(row)) {
        const hlc = clocks.get(rowKey(table, r.id, f)) ?? ZERO_HLC + device
        ops.push({ hlc, table, id: r.id, set: { [f]: row[f] } })
      }
    }
  }
  // Tombstones: rows deleted but still clocked. Keep them so older puts stay dead.
  for (const [k, hlc] of clocks) {
    if (!k.endsWith(sep + EXISTS) || live.has(k)) continue
    const [table, id] = k.split(sep) as [Table, string]
    ops.push({ hlc, table, id, del: true })
  }
  return ops
}
