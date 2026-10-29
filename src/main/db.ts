import { dirname, join } from 'path'
import { promises as fs } from 'fs'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import type { AppData } from '../shared/types'
import { AUDIT_LIMIT, type AuditEntry, type AuditFilter, type AuditRow } from '../shared/audit'

// Local SQLite database (sql.js, in-process wasm). One table per entity kind, each row holding
// the entity as JSON with its parent id indexed. Saves diff against the last write, so only
// changed rows are rewritten.

type Table = 'spaces' | 'initiatives' | 'teams' | 'projects' | 'issues' | 'cycles' | 'automations' | 'triage_rules' | 'templates' | 'dashboards' | 'notifications' | 'agents'

const TABLES: Table[] = ['spaces', 'initiatives', 'teams', 'projects', 'issues', 'cycles', 'automations', 'triage_rules', 'templates', 'dashboards', 'notifications', 'agents']

// AppData key for each table.
const KEY: Record<Table, keyof AppData> = {
  spaces: 'spaces',
  initiatives: 'initiatives',
  teams: 'teams',
  projects: 'projects',
  issues: 'issues',
  cycles: 'cycles',
  automations: 'automations',
  triage_rules: 'triageRules',
  templates: 'templates',
  dashboards: 'dashboards',
  notifications: 'notifications',
  agents: 'agents'
}

// Parent column per table, used to index child lookups.
const PARENT: Partial<Record<Table, string>> = {
  initiatives: 'space_id',
  teams: 'space_id',
  projects: 'space_id',
  issues: 'project_id',
  cycles: 'project_id',
  automations: 'project_id',
  triage_rules: 'project_id',
  templates: 'project_id',
  dashboards: 'space_id'
}

let sqlPromise: Promise<SqlJsStatic> | null = null

// The wasm file ships inside node_modules. Resolve it from the module itself: app.getAppPath()
// points at out/main in dev, so it cannot be used to find node_modules.
function sql() {
  sqlPromise ??= initSqlJs({
    locateFile: file => join(dirname(require.resolve('sql.js/dist/sql-wasm.js')), file)
  })
  return sqlPromise
}

export class Store {
  private db: Database | null = null
  // Last written JSON per table and id, so unchanged rows are skipped.
  private cache = new Map<Table, Map<string, string>>()
  private queue: Promise<void> = Promise.resolve()
  private flushing: Promise<void> = Promise.resolve()

  constructor(private file: string, private auditLimit = AUDIT_LIMIT) {}

  async open(): Promise<void> {
    const SQL = await sql()
    let bytes: Uint8Array | null = null
    try {
      bytes = new Uint8Array(await fs.readFile(this.file))
    } catch {
      bytes = null
    }
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database()
    for (const t of TABLES) {
      const parent = PARENT[t]
      this.db.run(
        `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, ${parent ? `${parent} TEXT NOT NULL, ` : ''}data TEXT NOT NULL)`
      )
      if (parent) this.db.run(`CREATE INDEX IF NOT EXISTS idx_${t}_${parent} ON ${t} (${parent})`)
    }
    this.db.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    // Sync bookkeeping: winning hlc per row (tombstones included) and sync files already applied.
    this.db.run('CREATE TABLE IF NOT EXISTS sync_clock (key TEXT PRIMARY KEY, hlc TEXT NOT NULL)')
    this.db.run('CREATE TABLE IF NOT EXISTS sync_applied (name TEXT PRIMARY KEY)')
    this.db.run('CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, source TEXT NOT NULL, action TEXT NOT NULL, tbl TEXT NOT NULL, target TEXT NOT NULL, fields TEXT)')
  }

  clocks(): Map<string, string> {
    const out = new Map<string, string>()
    if (!this.db) return out
    const res = this.db.exec('SELECT key, hlc FROM sync_clock')
    for (const r of res[0]?.values ?? []) out.set(String(r[0]), String(r[1]))
    return out
  }

  async setClocks(entries: [string, string][]): Promise<void> {
    if (!this.db || entries.length === 0) return
    this.db.run('BEGIN')
    try {
      for (const [key, hlc] of entries) this.db.run('INSERT OR REPLACE INTO sync_clock (key, hlc) VALUES (?, ?)', [key, hlc])
      this.db.run('COMMIT')
    } catch (err) {
      this.db.run('ROLLBACK')
      throw err
    }
    return this.flush()
  }

  appliedNames(): Set<string> {
    const out = new Set<string>()
    if (!this.db) return out
    const res = this.db.exec('SELECT name FROM sync_applied')
    for (const r of res[0]?.values ?? []) out.add(String(r[0]))
    return out
  }

  async markApplied(names: string[]): Promise<void> {
    if (!this.db || names.length === 0) return
    this.db.run('BEGIN')
    try {
      for (const n of names) this.db.run('INSERT OR IGNORE INTO sync_applied (name) VALUES (?)', [n])
      this.db.run('COMMIT')
    } catch (err) {
      this.db.run('ROLLBACK')
      throw err
    }
    return this.flush()
  }

  // Rows go into the open database only. The persist() call that follows each change writes them, so
  // there is no separate file write. Only the newest `auditLimit` rows are kept.
  appendAudit(entries: AuditEntry[]): void {
    if (!this.db || entries.length === 0) return
    this.db.run('BEGIN')
    try {
      for (const e of entries) {
        this.db.run('INSERT INTO audit (at, source, action, tbl, target, fields) VALUES (?, ?, ?, ?, ?, ?)', [
          e.at,
          e.source,
          e.action,
          e.table,
          e.targetId,
          e.fields ? JSON.stringify(e.fields) : null
        ])
      }
      const max = Number(this.db.exec('SELECT MAX(seq) FROM audit')[0].values[0][0])
      this.db.run('DELETE FROM audit WHERE seq <= ?', [max - this.auditLimit])
      this.db.run('COMMIT')
    } catch (err) {
      this.db.run('ROLLBACK')
      throw err
    }
  }

  // Newest first. `before` pages back from the seq of the last row already shown.
  readAudit(f: AuditFilter = {}): AuditRow[] {
    if (!this.db) return []
    const where: string[] = []
    const args: (string | number)[] = []
    if (f.source) {
      where.push('source = ?')
      args.push(f.source)
    }
    if (f.table) {
      where.push('tbl = ?')
      args.push(f.table)
    }
    if (f.q) {
      where.push('(target LIKE ? OR action LIKE ? OR fields LIKE ?)')
      args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`)
    }
    if (f.before) {
      where.push('seq < ?')
      args.push(f.before)
    }
    args.push(f.limit ?? 500)
    const sql = `SELECT seq, at, source, action, tbl, target, fields FROM audit ${where.length ? `WHERE ${where.join(' AND ')} ` : ''}ORDER BY seq DESC LIMIT ?`
    const res = this.db.exec(sql, args)
    return (res[0]?.values ?? []).map(r => ({
      seq: Number(r[0]),
      at: String(r[1]),
      source: String(r[2]) as AuditRow['source'],
      action: String(r[3]),
      table: String(r[4]),
      targetId: String(r[5]),
      ...(r[6] ? { fields: JSON.parse(String(r[6])) as string[] } : {})
    }))
  }

  // Wipes sync bookkeeping. Used when joining a folder and replaying it from scratch.
  resetSync() {
    if (!this.db) return
    this.db.run('DELETE FROM sync_clock')
    this.db.run('DELETE FROM sync_applied')
  }

  // True once a snapshot has been written. An empty workspace after deleting everything still counts.
  get initialized(): boolean {
    if (!this.db) return false
    const res = this.db.exec("SELECT value FROM meta WHERE key = 'initialized'")
    return res.length > 0
  }

  // Reads every table back into the AppData shape, or null when nothing was ever saved.
  read(): AppData | null {
    if (!this.db || !this.initialized) return null
    const all = (t: Table): unknown[] => {
      const res = this.db!.exec(`SELECT data FROM ${t} ORDER BY rowid`)
      return res[0] ? res[0].values.map(r => JSON.parse(String(r[0]))) : []
    }
    const meta = this.db.exec("SELECT value FROM meta WHERE key = 'me'")
    const me = meta[0] ? String(meta[0].values[0][0]) : 'You'
    const data: AppData = {
      version: 5,
      spaces: all('spaces') as AppData['spaces'],
      initiatives: all('initiatives') as AppData['initiatives'],
      teams: all('teams') as AppData['teams'],
      projects: all('projects') as AppData['projects'],
      issues: all('issues') as AppData['issues'],
      cycles: all('cycles') as AppData['cycles'],
      automations: all('automations') as AppData['automations'],
      triageRules: all('triage_rules') as AppData['triageRules'],
      templates: all('templates') as AppData['templates'],
      dashboards: all('dashboards') as AppData['dashboards'],
      notifications: all('notifications') as AppData['notifications'],
      agents: all('agents') as AppData['agents'],
      me
    }
    this.primeCache(data)
    return data
  }

  // Writes the snapshot. Serialised so overlapping saves never interleave.
  save(data: AppData): Promise<void> {
    this.queue = this.queue.then(() => this.write(data)).catch(err => console.error('save failed', err))
    return this.queue
  }

  private primeCache(data: AppData) {
    for (const t of TABLES) {
      const rows = new Map<string, string>()
      for (const row of (data[KEY[t]] ?? []) as { id: string }[]) rows.set(row.id, JSON.stringify(row))
      this.cache.set(t, rows)
    }
  }

  private write(data: AppData) {
    if (!this.db) return
    const db = this.db
    const groups: Record<Table, { id: string; parent?: string; json: string }[]> = {
      spaces: data.spaces.map(r => ({ id: r.id, json: JSON.stringify(r) })),
      initiatives: data.initiatives.map(r => ({ id: r.id, parent: r.spaceId, json: JSON.stringify(r) })),
      teams: data.teams.map(r => ({ id: r.id, parent: r.spaceId, json: JSON.stringify(r) })),
      projects: data.projects.map(r => ({ id: r.id, parent: r.spaceId, json: JSON.stringify(r) })),
      issues: data.issues.map(r => ({ id: r.id, parent: r.projectId, json: JSON.stringify(r) })),
      cycles: data.cycles.map(r => ({ id: r.id, parent: r.projectId, json: JSON.stringify(r) })),
      automations: data.automations.map(r => ({ id: r.id, parent: r.projectId, json: JSON.stringify(r) })),
      triage_rules: data.triageRules.map(r => ({ id: r.id, parent: r.projectId, json: JSON.stringify(r) })),
      templates: data.templates.map(r => ({ id: r.id, parent: r.projectId, json: JSON.stringify(r) })),
      dashboards: data.dashboards.map(r => ({ id: r.id, parent: r.spaceId, json: JSON.stringify(r) })),
      notifications: data.notifications.map(r => ({ id: r.id, json: JSON.stringify(r) })),
      agents: (data.agents ?? []).map(r => ({ id: r.id, json: JSON.stringify(r) }))
    }

    db.run('BEGIN')
    try {
      for (const t of TABLES) {
        const prev = this.cache.get(t) ?? new Map<string, string>()
        const next = new Map<string, string>()
        const parent = PARENT[t]
        for (const row of groups[t]) {
          next.set(row.id, row.json)
          if (prev.get(row.id) === row.json) continue
          if (parent) {
            db.run(`INSERT OR REPLACE INTO ${t} (id, ${parent}, data) VALUES (?, ?, ?)`, [row.id, row.parent ?? '', row.json])
          } else {
            db.run(`INSERT OR REPLACE INTO ${t} (id, data) VALUES (?, ?)`, [row.id, row.json])
          }
        }
        for (const id of prev.keys()) {
          if (!next.has(id)) db.run(`DELETE FROM ${t} WHERE id = ?`, [id])
        }
        this.cache.set(t, next)
      }
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('me', ?)", [data.me])
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('initialized', '1')")
      db.run('COMMIT')
    } catch (err) {
      db.run('ROLLBACK')
      throw err
    }
    return this.flush()
  }

  // Writes the database file. Calls are serialised: concurrent writers would share one temp file and
  // the second rename would fail with ENOENT.
  private flush(): Promise<void> {
    const run = this.flushing.then(() => this.writeFile())
    this.flushing = run.catch(() => undefined)
    return run
  }

  private async writeFile() {
    if (!this.db) return
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, Buffer.from(this.db.export()))
    await fs.rename(tmp, this.file)
  }
}
