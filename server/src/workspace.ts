import { DurableObject } from 'cloudflare:workers'
import { parse, TABLE_KEYS, type Op } from '../../src/shared/sync'
import type { Env } from './env'

// Wire protocol: JSON text frames. See docs/cloud-sync.md.
const MAX_FRAME = 1_000_000
const MAX_OPS = 1000
const BATCH = 500
const MAX_SKEW_MS = 5 * 60_000
const PUSH_TTL_MS = 24 * 3_600_000
const TABLES = new Set<string>(TABLE_KEYS.map(([t]) => t))
const HLC_RE = /^\d{15}\.\d{6}\.\S+$/

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ops (seq INTEGER PRIMARY KEY AUTOINCREMENT, hlc TEXT NOT NULL, device TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pushes (device TEXT NOT NULL, id TEXT NOT NULL, seqs TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (device, id))`,
  // Compacted state: the winning op per (table, id, field). field '$' is row existence.
  `CREATE TABLE IF NOT EXISTS snap (tbl TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, hlc TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (tbl, id, field))`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`
]

type Sql = SqlStorage
const rows = <T extends Record<string, SqlStorageValue>>(sql: Sql, text: string, ...params: SqlStorageValue[]) =>
  sql.exec<T>(text, ...params).toArray()
const run = (sql: Sql, text: string, ...params: SqlStorageValue[]) => {
  sql.exec(text, ...params).toArray()
}

interface Att {
  device: string
  hello: boolean
}

// A type alias, not an interface: rows<T> needs an implicit index signature.
type Entry = {
  tbl: string
  id: string
  field: string
  hlc: string
  body: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isField = (f: unknown): f is string => typeof f === 'string' && f !== '' && f !== '$' && !f.includes('\u0000') && f.length <= 64

// Returns why an op is invalid, or null when it is valid.
function opError(o: unknown): string | null {
  if (!isObj(o)) return 'op is not an object'
  if (typeof o.table !== 'string' || !TABLES.has(o.table)) return 'unknown table'
  if (typeof o.id !== 'string' || o.id === '' || o.id.includes('\u0000')) return 'bad id'
  if (typeof o.hlc !== 'string' || !HLC_RE.test(o.hlc)) return 'bad hlc'
  if (o.create && o.del) return 'op is both create and del'
  if (o.del) return null
  if (o.create) return isObj(o.set) && Object.keys(o.set).every(isField) ? null : 'bad create fields'
  if (o.set === undefined && o.unset === undefined) return 'op has no fields'
  if (o.set !== undefined && (!isObj(o.set) || !Object.keys(o.set).every(isField))) return 'bad set'
  if (o.unset !== undefined && (!Array.isArray(o.unset) || !o.unset.every(isField))) return 'bad unset'
  return null
}

// Per-field entries an op contributes to the compacted state.
function entriesOf(op: Op): Entry[] {
  const base = { tbl: op.table, id: op.id, hlc: op.hlc }
  const json = (body: object) => JSON.stringify(body)
  if (op.del) return [{ ...base, field: '$', body: json({ del: true }) }]
  const out: Entry[] = []
  if (op.create) out.push({ ...base, field: '$', body: json({ create: true, set: {} }) })
  for (const [f, v] of Object.entries(op.set ?? {})) out.push({ ...base, field: f, body: json({ set: { [f]: v } }) })
  for (const f of op.unset ?? []) out.push({ ...base, field: f, body: json({ unset: [f] }) })
  return out
}

// One instance named 'default'. All handlers are synchronous, so each push or hello runs without interleaving.
export class Workspace extends DurableObject<Env> {
  private compactAt: number
  private compactKeep: number

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.compactAt = Number(env.COMPACT_AT ?? 10_000)
    this.compactKeep = Number(env.COMPACT_KEEP ?? 2_000)
    ctx.blockConcurrencyWhile(async () => {
      for (const s of SCHEMA) run(ctx.storage.sql, s)
    })
  }

  // Called by the Worker after it has checked the device is active.
  async fetch(request: Request): Promise<Response> {
    const device = request.headers.get('X-Device-Id')
    if (!device || request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server, [device]) // tag = device id, so revocation can find its sockets
    server.serializeAttachment({ device, hello: false } satisfies Att)
    // Only echo the subprotocol when the client offered it (a ?access_token= client offers none).
    const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').some(p => p.trim() === 'prometheus-sync')
    return new Response(null, { status: 101, webSocket: client, headers: offered ? { 'Sec-WebSocket-Protocol': 'prometheus-sync' } : {} })
  }

  closeDevices(ids: string[]) {
    for (const id of ids) for (const ws of this.ctx.getWebSockets(id)) ws.close(4001, 'device revoked')
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > MAX_FRAME) return this.reply(ws, { type: 'error', code: 'too_large' })
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(message)
    } catch {
      return this.reply(ws, { type: 'error', code: 'bad_json' })
    }
    const att = ws.deserializeAttachment() as Att
    switch (msg.type) {
      case 'ping':
        return this.reply(ws, { type: 'pong', now: Date.now() })
      case 'hello':
        return this.hello(ws, att, msg.since ?? 0)
      case 'push':
        return this.push(ws, att, msg)
      default:
        return this.reply(ws, { type: 'error', code: 'unknown_type' })
    }
  }

  webSocketClose(ws: WebSocket) {
    ws.close()
  }

  webSocketError(ws: WebSocket) {
    ws.close(1011, 'socket error')
  }

  private floor(): number {
    return Number(rows<{ v: string }>(this.ctx.storage.sql, "SELECT v FROM meta WHERE k = 'floor'")[0]?.v ?? 0)
  }

  private head(): number {
    const max = rows<{ s: number | null }>(this.ctx.storage.sql, 'SELECT MAX(seq) AS s FROM ops')[0].s ?? 0
    return Math.max(this.floor(), max)
  }

  private reply(ws: WebSocket, frame: object) {
    ws.send(JSON.stringify(frame))
  }

  private sendOps(ws: WebSocket, list: { seq: number; op: Op }[], head: number) {
    for (let i = 0; i < list.length; i += BATCH) this.reply(ws, { type: 'ops', ops: list.slice(i, i + BATCH), head })
  }

  // Compacted state as ops. Row existence sorts first so field ops always find their row.
  private snapshotOps(): Op[] {
    return rows<Entry>(this.ctx.storage.sql, "SELECT tbl, id, field, hlc, body FROM snap ORDER BY tbl, id, field <> '$', field").map(
      e => ({ hlc: e.hlc, table: e.tbl, id: e.id, ...JSON.parse(e.body) }) as Op
    )
  }

  private hello(ws: WebSocket, att: Att, since: unknown) {
    if (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0) return this.reply(ws, { type: 'error', code: 'bad_request' })
    const sql = this.ctx.storage.sql
    const floor = this.floor()
    const head = this.head()
    if (since < floor) {
      const snap = this.snapshotOps()
      for (let i = 0; i < snap.length; i += BATCH) this.reply(ws, { type: 'snapshot', ops: snap.slice(i, i + BATCH), head })
    }
    const list = rows<{ seq: number; body: string }>(sql, 'SELECT seq, body FROM ops WHERE seq > ? ORDER BY seq', Math.max(since, floor)).map(r => ({
      seq: r.seq,
      op: JSON.parse(r.body) as Op
    }))
    this.sendOps(ws, list, head)
    this.reply(ws, { type: 'ready', head })
    ws.serializeAttachment({ ...att, hello: true } satisfies Att)
  }

  private push(ws: WebSocket, att: Att, msg: Record<string, unknown>) {
    const { id, ops } = msg
    if (typeof id !== 'string' || id === '' || id.length > 128 || !Array.isArray(ops) || ops.length === 0 || ops.length > MAX_OPS) {
      return this.reply(ws, { type: 'error', id, code: 'bad_request' })
    }
    const sql = this.ctx.storage.sql
    // A retry after reconnect: same ack, nothing appended and nothing broadcast again.
    const prior = rows<{ seqs: string }>(sql, 'SELECT seqs FROM pushes WHERE device = ? AND id = ?', att.device, id)[0]
    if (prior) return this.reply(ws, { type: 'ack', id, seqs: JSON.parse(prior.seqs), head: this.head() })

    for (let i = 0; i < ops.length; i++) {
      const err = opError(ops[i])
      if (err) return this.reply(ws, { type: 'error', id, code: 'invalid', index: i, message: err })
    }
    const typed = ops as Op[]
    const skewMs = Math.max(...typed.map(o => parse(o.hlc).ms)) - Date.now()
    if (skewMs > MAX_SKEW_MS) return this.reply(ws, { type: 'error', id, code: 'skew', skewMs })

    const now = Date.now()
    const seqs: number[] = []
    this.ctx.storage.transactionSync(() => {
      for (const op of typed) {
        seqs.push(rows<{ seq: number }>(sql, 'INSERT INTO ops (hlc, device, body, at) VALUES (?, ?, ?, ?) RETURNING seq', op.hlc, att.device, JSON.stringify(op), now)[0].seq)
      }
      run(sql, 'INSERT INTO pushes (device, id, seqs, at) VALUES (?, ?, ?, ?)', att.device, id, JSON.stringify(seqs), now)
      run(sql, 'DELETE FROM pushes WHERE at < ?', now - PUSH_TTL_MS)
      this.compact()
    })

    const head = this.head()
    this.reply(ws, { type: 'ack', id, seqs, head })
    const list = typed.map((op, i) => ({ seq: seqs[i], op }))
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws || !(other.deserializeAttachment() as Att | null)?.hello) continue
      this.sendOps(other, list, head)
    }
  }

  // Folds ops older than the newest `compactKeep` into snap, once the log passes `compactAt`.
  // Deletes win over older field edits: a row whose latest existence op is a delete keeps no fields.
  private compact() {
    const sql = this.ctx.storage.sql
    const count = rows<{ n: number }>(sql, 'SELECT COUNT(*) AS n FROM ops')[0].n
    if (count <= this.compactAt) return
    const edge = rows<{ seq: number }>(sql, 'SELECT seq FROM ops ORDER BY seq DESC LIMIT 1 OFFSET ?', Math.max(1, this.compactKeep) - 1)[0]?.seq
    if (edge === undefined) return
    const old = rows<{ seq: number; body: string }>(sql, 'SELECT seq, body FROM ops WHERE seq < ? ORDER BY seq', edge)
    if (old.length === 0) return

    const key = (e: Pick<Entry, 'tbl' | 'id' | 'field'>) => `${e.tbl}\u0000${e.id}\u0000${e.field}`
    const state = new Map<string, Entry>()
    for (const e of rows<Entry>(sql, 'SELECT tbl, id, field, hlc, body FROM snap')) state.set(key(e), e)
    for (const { body } of old) {
      for (const e of entriesOf(JSON.parse(body) as Op)) {
        const cur = state.get(key(e))
        if (!cur || cur.hlc < e.hlc) state.set(key(e), e)
      }
    }
    const dead = new Set([...state.values()].filter(e => e.field === '$' && JSON.parse(e.body).del).map(e => `${e.tbl}\u0000${e.id}`))
    for (const [k, e] of state) if (e.field !== '$' && dead.has(`${e.tbl}\u0000${e.id}`)) state.delete(k)

    const floor = old[old.length - 1].seq
    run(sql, 'DELETE FROM snap')
    for (const e of state.values()) run(sql, 'INSERT INTO snap (tbl, id, field, hlc, body) VALUES (?, ?, ?, ?, ?)', e.tbl, e.id, e.field, e.hlc, e.body)
    run(sql, 'DELETE FROM ops WHERE seq <= ?', floor)
    run(sql, "INSERT INTO meta (k, v) VALUES ('floor', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", String(floor))
  }
}
