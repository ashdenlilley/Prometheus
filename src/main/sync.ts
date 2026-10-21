import { join } from 'path'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { hostname } from 'os'
import type { AppData } from '../shared/types'
import { emptyData } from '../shared/seed'
import { Clock, applyOps, clockKey, diffOps, type Op } from '../shared/sync'
import type { Store } from './db'

// Folder sync over any synced folder (iCloud Drive, OneDrive, Dropbox, a shared drive).
//
// Layout:  <folder>/<deviceId>/<hlc>.ndjson   one immutable file per flush, one op per line.
//
// Each device writes only inside its own folder, so the cloud provider never sees two writers on
// one file. Files are written to a dot-prefixed temp name and renamed into place, so a reader
// never sees a half-written segment. Remote files are read by polling. Nothing is watched or
// locked. The local SQLite file stays in userData and is never placed in the synced folder.

export interface SyncStatus {
  enabled: boolean
  folder: string | null
  deviceId: string
  deviceName: string
  pending: number
  lastSync: number | null
  error: string | null
}

export interface SyncHooks {
  read(): AppData
  // Replaces the live copy and notifies the renderer. Called synchronously before any await.
  write(next: AppData): void
}

interface Config {
  folder: string | null
  deviceId: string
}

const POLL_MS = 3000
const FLUSH_MS = 400

export class SyncEngine {
  readonly clock: Clock
  private config: Config = { folder: null, deviceId: '' }
  private clocks = new Map<string, string>()
  private applied = new Set<string>()
  private outbox: Op[] = []
  private status: { lastSync: number | null; error: string | null } = { lastSync: null, error: null }
  private chain: Promise<unknown> = Promise.resolve()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private dir: string,
    private store: Store,
    private hooks: SyncHooks
  ) {
    this.clock = new Clock('')
  }

  async init(): Promise<void> {
    try {
      this.config = { ...this.config, ...JSON.parse(await fs.readFile(this.configFile(), 'utf8')) }
    } catch {
      /* first run */
    }
    if (!this.config.deviceId) {
      this.config.deviceId = randomUUID()
      await this.saveConfig()
    }
    this.clock.setDevice(this.config.deviceId)
    this.clocks = this.store.clocks()
    for (const hlc of this.clocks.values()) this.clock.observe(hlc)
    this.applied = this.store.appliedNames()
    if (this.config.folder) this.startPolling()
  }

  // Serialises engine work so poll, join and flush never interleave.
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  // Local change: remember its clock and queue it for the next segment.
  record(ops: Op[]) {
    if (ops.length === 0) return
    const entries: [string, string][] = []
    for (const op of ops) {
      this.clocks.set(clockKey(op.table, op.id), op.hlc)
      entries.push([clockKey(op.table, op.id), op.hlc])
    }
    void this.store.setClocks(entries).catch(err => console.error('sync clock save failed', err))
    // Without a folder, nothing is queued: join('push') seeds the folder from the full snapshot later.
    if (!this.config.folder) return
    this.outbox.push(...ops)
    this.scheduleFlush()
  }

  getStatus(): SyncStatus {
    return {
      enabled: !!this.config.folder,
      folder: this.config.folder,
      deviceId: this.config.deviceId,
      deviceName: hostname(),
      pending: this.outbox.length,
      lastSync: this.status.lastSync,
      error: this.status.error
    }
  }

  // Counts other devices already present in a folder. Does not change config.
  inspect(folder: string): Promise<{ devices: number; segments: number }> {
    return this.exclusive(async () => {
      const segs = await this.listSegments(folder)
      const devices = new Set(segs.map(s => s.device))
      devices.delete(this.config.deviceId)
      return { devices: devices.size, segments: segs.length }
    })
  }

  // Joins a folder. 'push' seeds it from this device. 'adopt' replaces local data with the folder's
  // contents. The caller decides between them, usually after inspect() found existing data.
  join(folder: string, mode: 'push' | 'adopt'): Promise<AppData> {
    return this.exclusive(async () => {
      await fs.mkdir(folder, { recursive: true })
      this.outbox = []
      this.config.folder = folder
      await this.saveConfig()
      this.startPolling()
      if (mode === 'push') {
        const current = this.hooks.read()
        this.record(diffOps(emptyData(), current, this.clock))
        await this.flushOutbox()
        return current
      }
      // Adopt: forget all sync bookkeeping, then replay every segment onto an empty workspace.
      this.clocks.clear()
      this.applied.clear()
      this.store.resetSync()
      this.hooks.write(emptyData())
      const result = await this.pull()
      return result ?? this.hooks.read()
    })
  }

  disable(): Promise<void> {
    return this.exclusive(async () => {
      this.config.folder = null
      this.outbox = []
      this.stopPolling()
      await this.saveConfig()
    })
  }

  // Writes queued ops now. Called on quit so the last edits reach the folder.
  flushNow(): Promise<void> {
    return this.exclusive(() => this.flushOutbox())
  }

  syncNow(): Promise<void> {
    return this.exclusive(async () => {
      await this.tick()
    })
  }

  private startPolling() {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => void this.syncNow(), POLL_MS)
    void this.syncNow()
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.exclusive(() => this.flushOutbox()).catch(() => undefined)
    }, FLUSH_MS)
  }

  // One poll cycle: push pending local ops, then pull remote segments.
  private async tick() {
    if (!this.config.folder) return
    try {
      await this.flushOutbox()
      const next = await this.pull()
      if (next) this.status.error = null
    } catch (err) {
      this.status.error = err instanceof Error ? err.message : String(err)
    }
  }

  private async flushOutbox() {
    if (!this.config.folder || this.outbox.length === 0) return
    const ops = this.outbox
    const folder = this.config.folder
    const dir = join(folder, this.config.deviceId)
    const name = `${ops.reduce((max, o) => (o.hlc > max ? o.hlc : max), '')}.ndjson`
    try {
      await fs.mkdir(dir, { recursive: true })
      const tmp = join(dir, `.${name}.tmp`)
      await fs.writeFile(tmp, ops.map(o => JSON.stringify(o)).join('\n') + '\n')
      await fs.rename(tmp, join(dir, name))
    } catch (err) {
      this.status.error = `Sync folder not writable: ${err instanceof Error ? err.message : String(err)}`
      throw err
    }
    // Only drop the ops once the segment exists. Anything queued meanwhile stays for the next flush.
    this.outbox = this.outbox.slice(ops.length)
    const key = `${this.config.deviceId}/${name}`
    this.applied.add(key)
    await this.store.markApplied([key])
    this.status.lastSync = Date.now()
    this.status.error = null
  }

  // Reads unseen remote segments and applies ops that beat the row's current clock.
  // Returns the new AppData when something changed, otherwise null.
  private async pull(): Promise<AppData | null> {
    if (!this.config.folder) return null
    const segs = (await this.listSegments(this.config.folder)).filter(s => !this.applied.has(s.key))
    if (segs.length === 0) return null

    const ops: Op[] = []
    const done: string[] = []
    for (const seg of segs) {
      let text: string
      try {
        text = await fs.readFile(seg.path, 'utf8')
      } catch {
        continue
      }
      // A line that does not parse means the file is not fully synced yet. Retry on the next poll.
      try {
        for (const line of text.split('\n')) if (line.trim()) ops.push(JSON.parse(line) as Op)
      } catch {
        continue
      }
      done.push(seg.key)
    }
    if (done.length === 0) return null

    // Read state after the awaits above, then apply synchronously.
    ops.sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0))
    const changed: Op[] = []
    for (const op of ops) {
      this.clock.observe(op.hlc)
      const key = clockKey(op.table, op.id)
      const current = this.clocks.get(key)
      if (current && current >= op.hlc) continue
      this.clocks.set(key, op.hlc)
      changed.push(op)
    }

    let next: AppData | null = null
    if (changed.length > 0) {
      next = applyOps(this.hooks.read(), changed)
      this.hooks.write(next)
    }
    const entries: [string, string][] = changed.map(op => [clockKey(op.table, op.id), op.hlc])
    await this.store.setClocks(entries)
    for (const k of done) this.applied.add(k)
    await this.store.markApplied(done)
    this.status.lastSync = Date.now()
    return next
  }

  private async listSegments(folder: string): Promise<{ key: string; device: string; path: string }[]> {
    const out: { key: string; device: string; path: string }[] = []
    const devices = await fs.readdir(folder, { withFileTypes: true })
    for (const d of devices) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue
      let files: string[]
      try {
        files = await fs.readdir(join(folder, d.name))
      } catch {
        continue
      }
      for (const f of files) {
        if (!f.endsWith('.ndjson') || f.startsWith('.')) continue
        out.push({ key: `${d.name}/${f}`, device: d.name, path: join(folder, d.name, f) })
      }
    }
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    return out
  }

  private configFile() {
    return join(this.dir, 'sync.json')
  }

  private async saveConfig() {
    await fs.mkdir(this.dir, { recursive: true })
    const tmp = `${this.configFile()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.config, null, 2))
    await fs.rename(tmp, this.configFile())
  }
}
