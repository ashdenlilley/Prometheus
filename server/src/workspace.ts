import { DurableObject } from 'cloudflare:workers'
import { parse, TABLE_KEYS, type Op } from '../../src/shared/sync'
import { ISSUE_SCOPE, PROJECT_SCOPE, accessChanged, canReadRow, columnMode, columnsError, isProjectAccess, mergeHidden, sameValue, stripHidden, valuesError, writeError, type ColumnAccess, type Principal, type ProjectAccess, type RowScope, type Role } from '../../src/shared/permissions'
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
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  // Scope index, derived from the ops: the winning project (or issue) ref per row, and each project's winning access.
  `CREATE TABLE IF NOT EXISTS scope (tbl TEXT NOT NULL, id TEXT NOT NULL, ref TEXT, hlc TEXT NOT NULL, PRIMARY KEY (tbl, id))`,
  `CREATE TABLE IF NOT EXISTS pacc (id TEXT PRIMARY KEY, access TEXT, hlc TEXT NOT NULL)`,
  // Field index: the winning projects.columns and issues.values per row (JSON, NULL when unset).
  `CREATE TABLE IF NOT EXISTS fval (tbl TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, v TEXT, hlc TEXT NOT NULL, PRIMARY KEY (tbl, id, field))`,
  `CREATE TABLE IF NOT EXISTS denials (at INTEGER NOT NULL, user TEXT NOT NULL, tbl TEXT NOT NULL, "row" TEXT NOT NULL, reason TEXT NOT NULL)`
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
  user: string
  role: Role
  projects: string[]
  name: string
  presence?: string | null
}

// A type alias, not an interface: rows<T> needs an implicit index signature.
type Entry = {
  tbl: string
  id: string
  field: string
  hlc: string
  body: string
}

type Col = { id: string; name: string; access?: ColumnAccess }

// Thrown inside a push's transaction so that none of its ops are kept.
class Refused extends Error {
  index: number
  constructor(index: number, reason: string) {
    super(reason)
    this.index = index
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isField = (f: unknown): f is string => typeof f === 'string' && f !== '' && f !== '$' && !f.includes('\u0000') && f.length <= 64
const principal = (a: Att): Principal => ({ userId: a.user, role: a.role, projects: a.projects })

// The field that places a row: 'access' for projects, else the table's project or issue field.
const scopeField = (tbl: string): string | undefined => (tbl === 'projects' ? 'access' : (PROJECT_SCOPE[tbl] ?? ISSUE_SCOPE[tbl]))
// The op's new value for a scope field: undefined when the op leaves it alone, null when it unsets it.
const scopeValue = (op: Op, field: string): unknown => (field in (op.set ?? {}) ? op.set?.[field] : op.unset?.includes(field) ? null : undefined)
// Whether an op sets or unsets a field.
const touches = (op: Op, field: string): boolean => field in (op.set ?? {}) || (op.unset?.includes(field) ?? false)

// Returns why an op is invalid, or null when it is valid.
function opError(o: unknown): string | null {
  if (!isObj(o)) return 'op is not an object'
  if (typeof o.table !== 'string' || !TABLES.has(o.table)) return 'unknown table'
  if (typeof o.id !== 'string' || o.id === '' || o.id.includes('\u0000')) return 'bad id'
  if (typeof o.hlc !== 'string' || !HLC_RE.test(o.hlc)) return 'bad hlc'
  if (o.create && o.del) return 'op is both create and del'
  if (o.table === 'projects' && isObj(o.set) && 'access' in o.set && !isProjectAccess(o.set.access)) return 'bad access'
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
      // Indexes are rebuilt from the logs once per index version ('2' adds the field index).
      if (rows<{ v: string }>(ctx.storage.sql, "SELECT v FROM meta WHERE k = 'scope_v'")[0]?.v !== '2') this.buildIndex()
    })
  }

  // Called by the Worker after it has checked the device and its user are active.
  async fetch(request: Request): Promise<Response> {
    const device = request.headers.get('X-Device-Id')
    const user = request.headers.get('X-User-Id')
    if (!device || !user || request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    // Tags: device id, so revocation can find its sockets, and u:<user>, so removal can.
    this.ctx.acceptWebSocket(server, [device, `u:${user}`])
    const att: Att = {
      device,
      hello: false,
      user,
      role: request.headers.get('X-Role') as Role,
      projects: JSON.parse(request.headers.get('X-Projects') ?? '[]'),
      name: decodeURIComponent(request.headers.get('X-User-Name') ?? '')
    }
    server.serializeAttachment(att)
    // Only echo the subprotocol when the client offered it.
    const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').some(p => p.trim() === 'prometheus-sync')
    return new Response(null, { status: 101, webSocket: client, headers: offered ? { 'Sec-WebSocket-Protocol': 'prometheus-sync' } : {} })
  }

  closeDevices(ids: string[]) {
    for (const id of ids) for (const ws of this.ctx.getWebSockets(id)) ws.close(4001, 'device revoked')
  }

  closeUser(userId: string, code: number, reason: string) {
    for (const ws of this.ctx.getWebSockets(`u:${userId}`)) ws.close(code, reason)
  }

  // Newest refusals first, for the owner's audit route.
  denials(limit = 100) {
    return rows<{ at: number; user: string; tbl: string; row: string; reason: string }>(
      this.ctx.storage.sql,
      'SELECT at, user, tbl, "row", reason FROM denials ORDER BY rowid DESC LIMIT ?',
      limit
    ).map(d => ({ at: d.at, user: d.user, table: d.tbl, row: d.row, reason: d.reason }))
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
      case 'presence':
        return this.presence(ws, att, msg.issueId)
      default:
        return this.reply(ws, { type: 'error', code: 'unknown_type' })
    }
  }

  webSocketClose(ws: WebSocket) {
    ws.close()
    this.broadcastPresence(ws)
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

  // Scope and field indexes: the winning scope field per row, and the winning columns and values, last-writer-wins by hlc. Deletes keep their index rows.
  private index(op: Op) {
    if (op.del) return
    const sql = this.ctx.storage.sql
    const field = scopeField(op.table)
    if (field) {
      const next = scopeValue(op, field)
      const val = next === null || next === undefined ? null : op.table === 'projects' ? JSON.stringify(next) : String(next)
      if (op.table === 'projects') {
        run(sql, "INSERT OR IGNORE INTO pacc (id, access, hlc) VALUES (?, NULL, '')", op.id)
        if (next !== undefined) run(sql, 'UPDATE pacc SET access = ?, hlc = ? WHERE id = ? AND hlc < ?', val, op.hlc, op.id, op.hlc)
      } else {
        run(sql, "INSERT OR IGNORE INTO scope (tbl, id, ref, hlc) VALUES (?, ?, NULL, '')", op.table, op.id)
        if (next !== undefined) run(sql, 'UPDATE scope SET ref = ?, hlc = ? WHERE tbl = ? AND id = ? AND hlc < ?', val, op.hlc, op.table, op.id, op.hlc)
      }
    }
    const f = op.table === 'projects' ? 'columns' : op.table === 'issues' ? 'values' : undefined
    if (f && touches(op, f)) {
      const next = scopeValue(op, f)
      run(sql, "INSERT OR IGNORE INTO fval (tbl, id, field, v, hlc) VALUES (?, ?, ?, NULL, '')", op.table, op.id, f)
      run(sql, 'UPDATE fval SET v = ?, hlc = ? WHERE tbl = ? AND id = ? AND field = ? AND hlc < ?', next === null ? null : JSON.stringify(next), op.hlc, op.table, op.id, f, op.hlc)
    }
  }

  private buildIndex() {
    this.ctx.storage.transactionSync(() => {
      run(this.ctx.storage.sql, 'DELETE FROM scope')
      run(this.ctx.storage.sql, 'DELETE FROM pacc')
      run(this.ctx.storage.sql, 'DELETE FROM fval')
      for (const op of this.snapshotOps()) this.index(op)
      for (const r of rows<{ body: string }>(this.ctx.storage.sql, 'SELECT body FROM ops ORDER BY seq')) this.index(JSON.parse(r.body) as Op)
      run(this.ctx.storage.sql, "INSERT OR REPLACE INTO meta (k, v) VALUES ('scope_v', '2')")
    })
  }

  private refOf(tbl: string, id: string): string | null {
    return rows<{ ref: string | null }>(this.ctx.storage.sql, 'SELECT ref FROM scope WHERE tbl = ? AND id = ?', tbl, id)[0]?.ref ?? null
  }

  // The winning value of a field from the field index, or undefined when unset or absent.
  private fieldOf(tbl: string, id: string, field: string): unknown {
    const v = rows<{ v: string | null }>(this.ctx.storage.sql, 'SELECT v FROM fval WHERE tbl = ? AND id = ? AND field = ?', tbl, id, field)[0]?.v
    return v === undefined || v === null ? undefined : JSON.parse(v)
  }

  // A project's custom columns; none when it has no columns or no row.
  private columnsOf(projectId: string | null): Col[] {
    const cols = projectId === null ? undefined : this.fieldOf('projects', projectId, 'columns')
    return Array.isArray(cols) ? cols : []
  }

  // OS-464: column rules for a non-owner's write. Returns why it is refused, and the op to store with hidden values kept.
  private columnCheck(p: Principal, op: Op, next: unknown): { reason: string | null; op: Op } {
    if (op.table === 'projects' && touches(op, 'columns')) {
      return { reason: columnsError(p.role, this.fieldOf('projects', op.id, 'columns') as Col[] | undefined, op.set?.columns as Col[] | undefined), op }
    }
    if (op.table !== 'issues' || !touches(op, 'values')) return { reason: null, op }
    const sets = op.set ?? {}
    const cols = this.columnsOf(this.resolve(op.table, op.id, next).project)
    const prior = this.fieldOf('issues', op.id, 'values') as Record<string, unknown> | undefined
    if (!('values' in sets)) {
      // Clearing values must not erase a hidden column's value, which the writer cannot see.
      const hidden = cols.some(c => columnMode(p.role, c) === 'hidden' && !sameValue(prior?.[c.id], undefined))
      return { reason: valuesError(p.role, cols, prior, undefined) ?? (hidden ? 'hidden column values cannot be cleared' : null), op }
    }
    const raw = sets.values as Record<string, unknown> | null
    if (raw !== null && !isObj(raw)) return { reason: 'values must be an object', op }
    return {
      reason: valuesError(p.role, cols, prior, raw ?? undefined),
      op: { ...op, set: { ...sets, values: mergeHidden(p.role, cols, prior, raw ?? {}) } }
    }
  }

  // What one principal may read of an op's values: hidden columns stripped. Other ops and owners pass through.
  private redactor(p: Principal): (op: Op) => Op {
    if (p.role === 'owner') return op => op
    return op => {
      if (op.table !== 'issues' || !op.set || !('values' in op.set)) return op
      const values = stripHidden(p.role, this.columnsOf(this.refOf('issues', op.id)), op.set.values as Record<string, unknown> | undefined)
      return values === op.set.values ? op : { ...op, set: { ...op.set, values } }
    }
  }

  private access(id: string): ProjectAccess | null {
    const a = rows<{ access: string | null }>(this.ctx.storage.sql, 'SELECT access FROM pacc WHERE id = ?', id)[0]?.access
    return a ? (JSON.parse(a) as ProjectAccess) : null
  }

  // The project a ref names, with its access. { project: null } when no project row has that id.
  private scopeOf(ref: string | null): RowScope {
    if (ref === null || !this.exists('projects', ref)) return { project: null }
    return { project: ref, access: this.access(ref) }
  }

  // The scope of a row as it is now. `next` replaces the stored scope field, for checking a write before it lands.
  private resolve(tbl: string, id: string, next?: unknown): RowScope {
    if (tbl === 'projects') return { project: id, access: next !== undefined ? (next as ProjectAccess | null) : this.access(id) }
    if (PROJECT_SCOPE[tbl]) return this.scopeOf(next !== undefined ? (next as string | null) : this.refOf(tbl, id))
    if (ISSUE_SCOPE[tbl]) {
      const issue = next !== undefined ? (next as string | null) : this.refOf(tbl, id)
      return this.scopeOf(issue === null ? null : this.refOf('issues', issue))
    }
    return { project: null }
  }

  // Whether the row has a scope entry. Unscoped tables always do.
  private exists(tbl: string, id: string): boolean {
    const sql = this.ctx.storage.sql
    if (tbl === 'projects') return rows<{ x: number }>(sql, 'SELECT 1 AS x FROM pacc WHERE id = ?', id).length > 0
    if (!scopeField(tbl)) return true
    return rows<{ x: number }>(sql, 'SELECT 1 AS x FROM scope WHERE tbl = ? AND id = ?', tbl, id).length > 0
  }

  // What one principal may read, op by op. Owners read everything; scope lookups are memoised per call.
  private readable(p: Principal): (op: Op) => boolean {
    if (p.role === 'owner') return () => true
    const memo = new Map<string, RowScope>()
    return op => {
      const k = `${op.table}\u0000${op.id}`
      let scope = memo.get(k)
      if (!scope) memo.set(k, (scope = this.resolve(op.table, op.id)))
      return canReadRow(p, op.table, scope)
    }
  }

  private hello(ws: WebSocket, att: Att, since: unknown) {
    if (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0) return this.reply(ws, { type: 'error', code: 'bad_request' })
    const sql = this.ctx.storage.sql
    const floor = this.floor()
    const head = this.head()
    const p = principal(att)
    const can = this.readable(p)
    const red = this.redactor(p)
    if (since < floor) {
      const snap = this.snapshotOps().filter(can).map(red)
      for (let i = 0; i < snap.length; i += BATCH) this.reply(ws, { type: 'snapshot', ops: snap.slice(i, i + BATCH), head })
    }
    const list = rows<{ seq: number; body: string }>(sql, 'SELECT seq, body FROM ops WHERE seq > ? ORDER BY seq', Math.max(since, floor))
      .map(r => ({ seq: r.seq, op: JSON.parse(r.body) as Op }))
      .filter(e => can(e.op))
      .map(e => ({ seq: e.seq, op: red(e.op) }))
    this.sendOps(ws, list, head)
    this.reply(ws, { type: 'ready', head, userId: att.user, role: att.role, projects: att.projects })
    ws.serializeAttachment({ ...att, hello: true } satisfies Att)
    this.broadcastPresence()
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
    const p = principal(att)
    const seqs: number[] = []
    // The ops as stored: hidden values merged back in, so every reader gets the merged op.
    const stored: Op[] = []
    // Set when a push changes a column rule; sockets that hold values under the old rules are closed.
    let rulesChanged = false
    // Rows whose scope this push changes, with the scope they had before. The first change wins.
    const moved = new Map<string, { tbl: string; id: string; before: RowScope }>()
    try {
      this.ctx.storage.transactionSync(() => {
        typed.forEach((given, i) => {
          let op = given
          const before = this.exists(op.table, op.id) ? this.resolve(op.table, op.id) : null
          const field = scopeField(op.table)
          const next = field ? scopeValue(op, field) : undefined
          if (p.role !== 'owner') {
            const fields = [...Object.keys(op.set ?? {}), ...(op.unset ?? [])]
            const reason = writeError(p, op.table, fields, before, op.del ? null : this.resolve(op.table, op.id, next))
            if (reason) throw new Refused(i, reason)
            const col = this.columnCheck(p, op, next)
            if (col.reason) throw new Refused(i, col.reason)
            op = col.op
          }
          if (op.table === 'projects' && touches(op, 'columns') && accessChanged(this.fieldOf('projects', op.id, 'columns') as Col[] | undefined, op.set?.columns as Col[] | undefined)) rulesChanged = true
          const key = `${op.table}\u0000${op.id}`
          if (next !== undefined && before && !moved.has(key)) moved.set(key, { tbl: op.table, id: op.id, before })
          seqs.push(rows<{ seq: number }>(sql, 'INSERT INTO ops (hlc, device, body, at) VALUES (?, ?, ?, ?) RETURNING seq', op.hlc, att.device, JSON.stringify(op), now)[0].seq)
          this.index(op)
          stored.push(op)
        })
        run(sql, 'INSERT INTO pushes (device, id, seqs, at) VALUES (?, ?, ?, ?)', att.device, id, JSON.stringify(seqs), now)
        run(sql, 'DELETE FROM pushes WHERE at < ?', now - PUSH_TTL_MS)
        this.compact()
      })
    } catch (e) {
      if (!(e instanceof Refused)) throw e
      const bad = typed[e.index]
      run(sql, 'INSERT INTO denials (at, user, tbl, "row", reason) VALUES (?, ?, ?, ?, ?)', now, att.user, bad.table, bad.id, e.message)
      run(sql, 'DELETE FROM denials WHERE rowid NOT IN (SELECT rowid FROM denials ORDER BY rowid DESC LIMIT 1000)')
      console.log(`refused ${bad.table}/${bad.id} for ${att.user}: ${e.message}`)
      return this.reply(ws, { type: 'error', id, code: 'forbidden', index: e.index, message: e.message })
    }

    const head = this.head()
    this.reply(ws, { type: 'ack', id, seqs, head })
    const list = stored.map((op, i) => ({ seq: seqs[i], op }))
    const after = [...moved.values()].map(m => ({ ...m, now: this.resolve(m.tbl, m.id) }))
    for (const other of this.ctx.getWebSockets()) {
      const a = other.deserializeAttachment() as Att | null
      if (other === ws || !a?.hello) continue
      const pr = principal(a)
      // A socket that gained or lost a row's scope, or holds values under old column rules, may be stale, so it closes and resyncs from 0.
      if ((rulesChanged && pr.role !== 'owner') || after.some(m => canReadRow(pr, m.tbl, m.before) !== canReadRow(pr, m.tbl, m.now))) {
        other.close(4003, 'access changed')
        continue
      }
      const can = this.readable(pr)
      const red = this.redactor(pr)
      this.sendOps(other, list.filter(e => can(e.op)).map(e => ({ seq: e.seq, op: red(e.op) })), head)
    }
  }

  private presence(ws: WebSocket, att: Att, issueId: unknown) {
    const ok = issueId === undefined || issueId === null || (typeof issueId === 'string' && issueId.length <= 64)
    if (!att.hello || !ok) return this.reply(ws, { type: 'error', code: 'bad_request' })
    ws.serializeAttachment({ ...att, presence: typeof issueId === 'string' ? issueId : null } satisfies Att)
    this.broadcastPresence()
  }

  // One presence frame per hello'd socket. Each user appears once, with an issue if any of their sockets is on one.
  private broadcastPresence(skip?: WebSocket) {
    const live = this.ctx.getWebSockets().filter(ws => ws !== skip && (ws.deserializeAttachment() as Att | null)?.hello)
    const users = new Map<string, { userId: string; name: string; issueId?: string }>()
    for (const ws of live) {
      const a = ws.deserializeAttachment() as Att
      const cur = users.get(a.user)
      if (!cur || (!cur.issueId && a.presence)) users.set(a.user, { userId: a.user, name: a.name, ...(a.presence ? { issueId: a.presence } : {}) })
    }
    for (const ws of live) {
      const pr = principal(ws.deserializeAttachment() as Att)
      const list = [...users.values()].flatMap(u => {
        if (pr.role === 'owner') return [u]
        const seen = u.issueId !== undefined && canReadRow(pr, 'issues', this.resolve('issues', u.issueId))
        // Guests see only users on an issue they can read, plus themselves.
        if (pr.role === 'guest' && !seen && u.userId !== pr.userId) return []
        return [seen || u.issueId === undefined ? u : { userId: u.userId, name: u.name }]
      })
      this.reply(ws, { type: 'presence', users: list })
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
