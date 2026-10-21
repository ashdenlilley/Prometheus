import { basename, dirname, join } from 'path'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { hostname } from 'os'
import type { AppData } from '../shared/types'
import { emptyData } from '../shared/seed'
import { Clock, applyOps, diffOps, opKeys, snapshotOps, stampOps, type Op } from '../shared/sync'
import { createMeta, open as openSealed, seal, unlockMeta, type FolderMeta, type Sealed } from './crypto'
import type { Store } from './db'

// Folder sync over any synced folder (iCloud Drive, OneDrive, Dropbox, a shared drive).
//
// Layout:
//   <folder>/prometheus-sync.json            passphrase check (salt + sealed marker)
//   <folder>/<deviceId>/<hlc>.ndjson         sealed segment, one flush each
//   <folder>/<deviceId>/<hlc>.snap.ndjson    sealed snapshot written by compaction
//
// Each device writes only inside its own folder. Segments are sealed with AES-256-GCM under a key
// derived from the sync passphrase, so the folder holds ciphertext only. Writes go to a dot-temp
// name and are renamed into place. Remote folders are polled, never watched.

export interface SyncStatus {
  enabled: boolean
  folder: string | null
  deviceId: string
  deviceName: string
  pending: number
  lastSync: number | null
  error: string | null
  // Folder is set but this device has no key yet (e.g. after a config reset). Shown in Settings.
  needsPassphrase: boolean
}

export interface SyncHooks {
  read(): AppData
  // Replaces the live copy and notifies the renderer. Called synchronously before any await.
  write(next: AppData): void
  // Keeps the derived key in the OS keychain (Electron safeStorage) rather than in plain config.
  keys: {
    seal(key: Buffer): string
    open(sealed: string): Buffer | null
  }
}

interface Config {
  folder: string | null
  deviceId: string
  keyEnc: string | null
}

const POLL_MS = 3000
const FLUSH_MS = 400
// Compact once this device holds more than this many segments in the folder.
const COMPACT_AT = 100
// Ops stamped further ahead of this device's clock than this are rejected. See docs/sync.md.
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000
const META_FILE = 'prometheus-sync.json'

interface Segment {
  key: string
  device: string
  path: string
  name: string
}

export class SyncEngine {
  readonly clock: Clock
  private config: Config = { folder: null, deviceId: '', keyEnc: null }
  private key: Buffer | null = null
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
    if (!this.config.deviceId) this.config.deviceId = randomUUID()
    this.clock.setDevice(this.config.deviceId)
    this.key = this.config.keyEnc ? this.hooks.keys.open(this.config.keyEnc) : null
    await this.saveConfig()
    this.clocks = this.store.clocks()
    for (const hlc of this.clocks.values()) this.clock.observe(hlc)
    this.applied = this.store.appliedNames()
    if (this.config.folder && this.key) this.startPolling()
    else if (this.config.folder) this.status.error = 'Enter the sync passphrase to resume sync.'
  }

  // Serialises engine work so poll, join, flush and compaction never interleave.
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  // Local change: stamp its clocks and queue it for the next segment.
  record(ops: Op[]) {
    if (ops.length === 0) return
    const entries = stampOps(this.clocks, ops)
    void this.store.setClocks(entries).catch(err => console.error('sync clock save failed', err))
    // Without a folder nothing is queued. join('push') seeds the folder from the full snapshot.
    if (!this.config.folder || !this.key) return
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
      error: this.status.error,
      needsPassphrase: !!this.config.folder && !this.key
    }
  }

  // Looks at a folder without changing config. Reports whether it is encrypted and how many other
  // devices already wrote to it.
  inspect(folder: string): Promise<{ devices: number; segments: number; encrypted: boolean }> {
    return this.exclusive(async () => {
      const encrypted = (await readMeta(folder)) !== null
      const segs = await this.listSegments(folder)
      const devices = new Set(segs.map(s => s.device))
      devices.delete(this.config.deviceId)
      return { devices: devices.size, segments: segs.length, encrypted }
    })
  }

  // Joins a folder. 'push' seeds it from this device. 'adopt' replaces local data with the folder's
  // contents. A new folder gets a passphrase check. An existing one must match the passphrase.
  join(folder: string, mode: 'push' | 'adopt', passphrase: string): Promise<void> {
    return this.exclusive(async () => {
      await fs.mkdir(folder, { recursive: true })
      let meta = await readMeta(folder)
      let key: Buffer | null
      if (meta) {
        key = await unlockMeta(passphrase, meta)
        if (!key) throw new Error('Wrong passphrase for this sync folder.')
      } else {
        const made = await createMeta(passphrase)
        meta = made.meta
        key = made.key
        await writeAtomic(join(folder, META_FILE), JSON.stringify(meta, null, 2))
      }

      this.outbox = []
      this.key = key
      this.config.folder = folder
      this.config.keyEnc = this.hooks.keys.seal(key)
      await this.saveConfig()
      this.startPolling()

      if (mode === 'push') {
        this.record(diffOps(emptyData(), this.hooks.read(), this.clock))
        await this.flushOutbox()
        return
      }
      // Adopt: forget bookkeeping, then replay every segment onto an empty workspace.
      this.clocks.clear()
      this.applied.clear()
      this.store.resetSync()
      this.hooks.write(emptyData())
      await this.pull()
    })
  }

  // Re-enters the passphrase on a device whose folder is set but whose key is gone.
  unlock(passphrase: string): Promise<void> {
    return this.exclusive(async () => {
      if (!this.config.folder) throw new Error('No sync folder set.')
      const meta = await readMeta(this.config.folder)
      if (!meta) throw new Error('Sync folder has no passphrase check. Join it again.')
      const key = await unlockMeta(passphrase, meta)
      if (!key) throw new Error('Wrong passphrase for this sync folder.')
      this.key = key
      this.config.keyEnc = this.hooks.keys.seal(key)
      await this.saveConfig()
      this.status.error = null
      this.startPolling()
    })
  }

  disable(): Promise<void> {
    return this.exclusive(async () => {
      this.config.folder = null
      this.config.keyEnc = null
      this.key = null
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
    return this.exclusive(() => this.tick())
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
      void this.flushNow().catch(() => undefined)
    }, FLUSH_MS)
  }

  // One poll cycle: push pending local ops, pull remote segments, compact if needed.
  private async tick() {
    if (!this.config.folder || !this.key) return
    try {
      // Cleared first so a warning raised during this cycle (e.g. skew) survives it.
      this.status.error = null
      await this.flushOutbox()
      await this.pull()
      await this.maybeCompact()
    } catch (err) {
      this.status.error = err instanceof Error ? err.message : String(err)
    }
  }

  private async flushOutbox() {
    if (!this.config.folder || !this.key || this.outbox.length === 0) return
    const ops = this.outbox
    const name = `${maxHlc(ops)}.ndjson`
    await this.writeSegment(name, ops)
    this.outbox = this.outbox.slice(ops.length)
    this.status.lastSync = Date.now()
  }

  // Seals and writes ops as one segment, then marks it applied locally.
  private async writeSegment(name: string, ops: Op[]) {
    const dir = join(this.config.folder!, this.config.deviceId)
    await fs.mkdir(dir, { recursive: true })
    const body = ops.map(o => JSON.stringify(o)).join('\n') + '\n'
    await writeAtomic(join(dir, name), JSON.stringify(seal(this.key!, body)))
    const key = `${this.config.deviceId}/${name}`
    this.applied.add(key)
    await this.store.markApplied([key])
  }

  // Reads unseen remote segments and applies ops that beat each field's clock.
  private async pull(): Promise<void> {
    if (!this.config.folder || !this.key) return
    const segs = (await this.listSegments(this.config.folder)).filter(s => !this.applied.has(s.key))
    if (segs.length === 0) return

    const ops: Op[] = []
    const done: string[] = []
    let rejected = 0
    const limit = Date.now() + MAX_FUTURE_MS
    for (const seg of segs) {
      let sealed: Sealed
      try {
        sealed = JSON.parse(await fs.readFile(seg.path, 'utf8'))
      } catch {
        continue // partly synced or unreadable. Retry on the next poll.
      }
      let body: string
      try {
        body = openSealed(this.key, sealed)
      } catch {
        this.status.error = `Cannot decrypt ${seg.key}. Wrong passphrase or damaged file.`
        continue
      }
      const batch = body.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as Op)
      if (batch.some(o => parseHlcMs(o.hlc) > limit)) {
        rejected++
        continue
      }
      ops.push(...batch)
      done.push(seg.key)
    }
    if (rejected) this.status.error = `${rejected} segment(s) skipped: device clock is more than 24 h ahead.`
    if (ops.length === 0) {
      await this.markDone(done)
      return
    }

    ops.sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0))
    for (const op of ops) this.clock.observe(op.hlc)
    // Read the live state after the awaits above, then apply synchronously.
    const result = applyOps(this.hooks.read(), ops, this.clocks)
    if (result.applied > 0) this.hooks.write(result.data)
    const entries: [string, string][] = []
    for (const op of ops) for (const k of opKeys(op)) entries.push([k, this.clocks.get(k)!])
    await this.store.setClocks(entries)
    await this.markDone(done)
    this.status.lastSync = Date.now()
  }

  private async markDone(keys: string[]) {
    for (const k of keys) this.applied.add(k)
    await this.store.markApplied(keys)
  }

  // Once this device has many segments, replace them with one snapshot. The snapshot carries each
  // field's winning hlc, so replaying it cannot overwrite anything newer.
  private async maybeCompact() {
    const mine = (await this.listSegments(this.config.folder!)).filter(s => s.device === this.config.deviceId)
    if (mine.length <= COMPACT_AT || this.outbox.length > 0) return
    const ops = snapshotOps(this.hooks.read(), this.clocks, this.config.deviceId)
    if (ops.length === 0) return
    const name = `${maxHlc(ops)}.snap.ndjson`
    await this.writeSegment(name, ops)
    // Never delete the snapshot just written, even if its name matched an older one.
    for (const s of mine) {
      if (s.name !== name) await fs.rm(s.path, { force: true })
    }
  }

  private async listSegments(folder: string): Promise<Segment[]> {
    const out: Segment[] = []
    let devices: import('fs').Dirent[]
    try {
      devices = await fs.readdir(folder, { withFileTypes: true })
    } catch {
      return out // folder missing or unreachable: nothing to read yet
    }
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
        out.push({ key: `${d.name}/${f}`, device: d.name, path: join(folder, d.name, f), name: f })
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
    await writeAtomic(this.configFile(), JSON.stringify(this.config, null, 2))
  }
}

async function readMeta(folder: string): Promise<FolderMeta | null> {
  try {
    return JSON.parse(await fs.readFile(join(folder, META_FILE), 'utf8')) as FolderMeta
  } catch {
    return null
  }
}

async function writeAtomic(file: string, text: string) {
  const tmp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`)
  await fs.writeFile(tmp, text)
  await fs.rename(tmp, file)
}

function parseHlcMs(hlc: string) {
  return Number(hlc.slice(0, 15))
}

function maxHlc(ops: Op[]) {
  return ops.reduce((max, o) => (o.hlc > max ? o.hlc : max), '')
}
