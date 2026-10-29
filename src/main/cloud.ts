import { randomUUID } from 'crypto'
import { basename, dirname, join } from 'path'
import { promises as fs } from 'fs'
import type { AppData } from '../shared/types'
import { emptyData } from '../shared/seed'
import { ensureTeams, resolveNumberClashes } from '../shared/teams'
import { applyOps, opKeys, snapshotOps, type Clock, type Op } from '../shared/sync'

// Cloud sync client (OS-359). Talks to server/ over HTTPS and one WebSocket; see docs/cloud-sync.md.
// No Electron imports, so tests run it in plain Node. Local ops are stamped by the folder engine's
// record() before they reach record() here: this class only queues, sends and applies.

export const SIGNED_OUT = 'This device was signed out. Sign in again.'
const REFRESH_KEY = 'cloud.refreshToken'
const SIGN_IN_MS = 15 * 60_000
const REFRESH_MARGIN_MS = 60_000
const MAX_BATCH = 1000
const CONFIG_FILE = 'cloud-sync.json'
const OUTBOX_FILE = 'cloud-outbox.json'

export type CloudState = 'off' | 'signing-in' | 'connecting' | 'connected' | 'offline' | 'error'

export interface CloudStatus {
  enabled: boolean
  serverUrl: string
  email: string
  deviceId: string
  deviceName: string
  state: CloudState
  pending: number
  lastSync: number | null
  error: string | null
  signIn: { email: string; expiresAt: number } | null
  // Signed in, and the server already has data: the user must pick merge or adopt.
  needsJoin: boolean
}

export interface CloudDevice {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  current: boolean
}

// The part of WebSocket this class uses. The real one comes from globalThis; tests pass a fake.
export interface SocketLike {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number }) => void) | null
}
export type SocketCtor = new (url: string, protocols: string[]) => SocketLike

export interface CloudOptions {
  dir: string
  store: { setClocks(entries: [string, string][]): Promise<void>; clearClocks(): Promise<void> }
  // The folder engine's clock and clock map. Shared, so both engines agree on every field's winning hlc.
  clock: Clock
  clocks: Map<string, string>
  hooks: { read(): AppData; write(next: AppData): void }
  // Refresh token only. Sealed by the OS keychain in the app; never in the config file or logs.
  credentials: { get(name: string): Promise<string | null>; set(name: string, value: string): Promise<void>; delete(name: string): Promise<void> }
  fetch?: typeof fetch
  WebSocket?: SocketCtor
  now?: () => number
  pollMs?: number
  pingMs?: number
  minRetryMs?: number
  maxRetryMs?: number
}

interface Config {
  serverUrl: string
  email: string
  deviceId: string
  deviceName: string
  lastSeq: number
  enabled: boolean
  joined: boolean
}

// `inflight` is the batch sent but not yet acked. Its id is kept, so a retry after reconnect is idempotent.
interface Outbox {
  inflight: { id: string; count: number } | null
  ops: Op[]
}

interface Pending {
  serverUrl: string
  email: string
  deviceName: string
  requestId: string
  pollSecret: string
  expiresAt: number
}

type Frame =
  | { type: 'ready'; head: number }
  | { type: 'snapshot'; ops: Op[] }
  | { type: 'ops'; ops: { seq: number; op: Op }[] }
  | { type: 'ack'; id: string }
  | { type: 'error'; id?: string; code: string; skewMs?: number; message?: string }
  | { type: 'pong' }

const BLANK: Config = { serverUrl: '', email: '', deviceId: '', deviceName: '', lastSeq: 0, enabled: false, joined: false }

// https only, except a loopback server (local development and tests).
export function normalizeServerUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Enter a valid server URL.')
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('The server URL must start with https://.')
  return url.origin
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function readJson<T>(file: string): Promise<Partial<T>> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Partial<T>
  } catch {
    return {}
  }
}

async function writeAtomic(file: string, text: string) {
  const tmp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`)
  await fs.writeFile(tmp, text)
  await fs.rename(tmp, file)
}

export class CloudSync {
  private config: Config = { ...BLANK }
  private outbox: Outbox = { inflight: null, ops: [] }
  private pending: Pending | null = null
  private access: { token: string; expiresAt: number } | null = null
  private socket: SocketLike | null = null
  private ready = false
  // A push is out and not yet acked (or rejected for skew). Cleared on reconnect.
  private awaiting = false
  // Server head seen before joining. Decides whether the user must choose merge or adopt.
  private probeHead: number | null = null
  private error: string | null = null
  private lastSync: number | null = null
  private attempt = 0
  private stopped = false
  private refreshing: Promise<void> | null = null
  private chain: Promise<void> = Promise.resolve()
  private timers: Partial<Record<'poll' | 'retry' | 'refresh', ReturnType<typeof setTimeout>>> = {}
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private readonly fetch: typeof fetch
  private readonly Socket: SocketCtor
  private readonly now: () => number
  private readonly pollMs: number
  private readonly pingMs: number
  private readonly minRetryMs: number
  private readonly maxRetryMs: number

  constructor(private opts: CloudOptions) {
    this.fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.Socket = opts.WebSocket ?? (globalThis.WebSocket as unknown as SocketCtor)
    this.now = opts.now ?? (() => Date.now())
    this.pollMs = opts.pollMs ?? 2000
    this.pingMs = opts.pingMs ?? 30_000
    this.minRetryMs = opts.minRetryMs ?? 1000
    this.maxRetryMs = opts.maxRetryMs ?? 60_000
  }

  async init(): Promise<void> {
    this.config = { ...BLANK, ...(await readJson<Config>(this.file(CONFIG_FILE))) }
    this.outbox = { inflight: null, ops: [], ...(await readJson<Outbox>(this.file(OUTBOX_FILE))) }
    if (this.config.enabled) void this.connect()
  }

  // Ends timers and the socket. Pending local ops stay in the outbox for the next start.
  stop() {
    this.stopped = true
    this.halt()
  }

  getStatus(): CloudStatus {
    const c = this.config
    const state: CloudState = this.pending
      ? 'signing-in'
      : !c.enabled
        ? 'off'
        : this.error
          ? 'error'
          : this.ready
            ? 'connected'
            : this.socket
              ? 'connecting'
              : 'offline'
    return {
      enabled: c.enabled,
      serverUrl: c.serverUrl,
      email: c.email,
      deviceId: c.deviceId,
      deviceName: c.deviceName,
      state,
      pending: this.outbox.ops.length,
      lastSync: this.lastSync,
      error: this.error,
      signIn: this.pending ? { email: this.pending.email, expiresAt: this.pending.expiresAt } : null,
      needsJoin: c.enabled && !c.joined && (this.probeHead ?? 0) > 0
    }
  }

  // Local change, already stamped by the folder engine. Queued until the server acks it.
  record(ops: Op[]) {
    if (ops.length === 0 || !this.config.enabled) return
    this.outbox.ops.push(...ops)
    void this.save()
    this.pump()
  }

  // Sends a sign-in link to `email` and starts polling for the device's tokens.
  async startSignIn(serverUrl: string, email: string, deviceName: string): Promise<void> {
    if (this.config.enabled) throw new Error('Sign out of cloud sync first.')
    const base = normalizeServerUrl(serverUrl)
    const started = this.now()
    const res = await this.fetch(`${base}/auth/start`, post({ email, deviceName }))
    if (!res.ok) throw new Error(res.status === 429 ? 'Too many sign-in links requested. Try again in a few minutes.' : `Could not send the sign-in link (HTTP ${res.status}).`)
    const { requestId, pollSecret, expiresAt } = (await res.json()) as { requestId: string; pollSecret: string; expiresAt: number }
    this.pending = { serverUrl: base, email: email.trim(), deviceName, requestId, pollSecret, expiresAt: Math.min(expiresAt, started + SIGN_IN_MS) }
    this.error = null
    this.schedulePoll(this.pollMs)
  }

  cancelSignIn() {
    this.pending = null
    this.clearTimer('poll')
  }

  // First connection after sign-in: merge sends this device's data to the server, adopt replaces this
  // device's data with the server's copy. Only one of them ever runs for a device.
  async join(mode: 'merge' | 'adopt'): Promise<void> {
    if (!this.config.enabled || this.config.joined) throw new Error('Nothing to join.')
    if (mode === 'adopt') {
      this.opts.clocks.clear()
      await this.opts.store.clearClocks()
      this.opts.hooks.write(emptyData())
      this.outbox = { inflight: null, ops: [] }
      this.config.lastSeq = 0
    } else {
      this.outbox = { inflight: null, ops: snapshotOps(this.opts.hooks.read(), this.opts.clocks, this.config.deviceId) }
    }
    this.config.joined = true
    this.probeHead = null
    await this.save()
    this.reconnect()
  }

  devices(): Promise<CloudDevice[]> {
    return this.authed('/devices').then(async res => {
      if (!res.ok) throw new Error(`Could not load devices (HTTP ${res.status}).`)
      return (await res.json()) as CloudDevice[]
    })
  }

  async revokeDevice(id: string): Promise<void> {
    const res = await this.authed(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(res.status === 404 ? 'That device is already gone.' : `Could not revoke the device (HTTP ${res.status}).`)
  }

  // Revokes this device on the server when reachable, then forgets the sign-in. Local data stays.
  async signOut(): Promise<void> {
    if (!this.config.enabled) return
    this.halt() // so the server's 4001 close for this device is not read as a forced sign-out
    try {
      await this.authed(`/devices/${encodeURIComponent(this.config.deviceId)}`, { method: 'DELETE' })
    } catch {
      /* unreachable: sign out locally anyway */
    }
    await this.forget(null)
  }

  private file(name: string) {
    return join(this.opts.dir, name)
  }

  // Writes are chained and read the current state when they run, so the last write always has the latest.
  private save(): Promise<void> {
    this.chain = this.chain
      .then(async () => {
        await fs.mkdir(this.opts.dir, { recursive: true })
        await writeAtomic(this.file(CONFIG_FILE), JSON.stringify(this.config, null, 2))
        await writeAtomic(this.file(OUTBOX_FILE), JSON.stringify(this.outbox))
      })
      .catch(err => console.error('cloud sync save failed', err instanceof Error ? err.message : 'unknown'))
    return this.chain
  }

  private later(name: 'poll' | 'retry' | 'refresh', ms: number, fn: () => void) {
    this.clearTimer(name)
    this.timers[name] = setTimeout(fn, ms)
  }

  private clearTimer(name: 'poll' | 'retry' | 'refresh') {
    clearTimeout(this.timers[name])
    delete this.timers[name]
  }

  // Closes the socket and cancels every timer. Does not touch config or tokens.
  private halt() {
    const ws = this.socket
    this.socket = null
    this.ready = false
    this.awaiting = false
    this.clearTimer('poll')
    this.clearTimer('retry')
    this.clearTimer('refresh')
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    ws?.close()
  }

  // Drops the socket and reconnects now (e.g. after join, so the catch-up starts from lastSeq).
  private reconnect() {
    const ws = this.socket
    this.socket = null
    this.ready = false
    this.awaiting = false
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    ws?.close()
    void this.connect()
  }

  // Forgets the sign-in on this device: refresh token, config and outbox go. Local data stays.
  private async forget(error: string | null) {
    this.halt()
    this.access = null
    this.pending = null
    this.config = { ...BLANK }
    this.outbox = { inflight: null, ops: [] }
    this.probeHead = null
    this.error = error
    await this.opts.credentials.delete(REFRESH_KEY)
    await this.save()
  }

  private schedulePoll(ms: number) {
    this.later('poll', ms, () => void this.pollSignIn())
  }

  private async pollSignIn() {
    const p = this.pending
    if (!p) return
    if (this.now() >= p.expiresAt) {
      this.pending = null
      this.error = 'Sign-in timed out. Send a new link.'
      return
    }
    let res: Response
    try {
      res = await this.fetch(`${p.serverUrl}/auth/poll`, post({ requestId: p.requestId, pollSecret: p.pollSecret }))
    } catch {
      return this.schedulePoll(this.pollMs)
    }
    if (this.pending !== p) return // cancelled or replaced while the request was out
    if (res.status === 200) {
      try {
        await this.finishSignIn(p, (await res.json()) as { refreshToken: string; accessToken: string; accessExpiresAt: number; deviceId: string })
      } catch (err) {
        this.pending = null
        this.error = err instanceof Error ? err.message : 'Sign-in failed.'
      }
      return
    }
    if (res.status === 202 || res.status === 429 || res.status >= 500) return this.schedulePoll(this.pollMs)
    this.pending = null
    this.error =
      res.status === 410
        ? 'That sign-in link expired or was already used. Send a new one.'
        : res.status === 404
          ? 'Sign-in request not found. Send a new one.'
          : `Sign-in failed (HTTP ${res.status}).`
  }

  private async finishSignIn(p: Pending, body: { refreshToken: string; accessToken: string; accessExpiresAt: number; deviceId: string }) {
    await this.opts.credentials.set(REFRESH_KEY, body.refreshToken)
    this.pending = null
    this.config = { serverUrl: p.serverUrl, email: p.email, deviceId: body.deviceId, deviceName: p.deviceName, lastSeq: 0, enabled: true, joined: false }
    this.access = { token: body.accessToken, expiresAt: body.accessExpiresAt }
    this.outbox = { inflight: null, ops: [] }
    this.error = null
    await this.save()
    this.scheduleRefresh()
    void this.connect()
  }

  private accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt - this.now() > REFRESH_MARGIN_MS) return Promise.resolve(this.access.token)
    return this.refresh().then(() => this.access!.token)
  }

  // Shared by concurrent callers. The rotated refresh token is saved before the new access token is used.
  private refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async doRefresh() {
    const refreshToken = await this.opts.credentials.get(REFRESH_KEY)
    if (!refreshToken) {
      await this.forget(SIGNED_OUT)
      throw new Error(SIGNED_OUT)
    }
    const res = await this.fetch(`${this.config.serverUrl}/auth/refresh`, post({ refreshToken }))
    if (res.status === 401) {
      await this.forget(SIGNED_OUT)
      throw new Error(SIGNED_OUT)
    }
    if (!res.ok) throw new Error(`Token refresh failed (HTTP ${res.status}).`)
    const body = (await res.json()) as { refreshToken: string; accessToken: string; accessExpiresAt: number }
    await this.opts.credentials.set(REFRESH_KEY, body.refreshToken)
    this.access = { token: body.accessToken, expiresAt: body.accessExpiresAt }
    this.scheduleRefresh()
  }

  private scheduleRefresh() {
    if (!this.access || !this.config.enabled || this.stopped) return
    const delay = Math.max(this.minRetryMs, this.access.expiresAt - this.now() - REFRESH_MARGIN_MS)
    this.later('refresh', delay, () => {
      this.refresh().then(
        () => this.scheduleRefresh(),
        () => this.later('refresh', this.maxRetryMs, () => this.scheduleRefresh())
      )
    })
  }

  // Bearer request for the device-management API. A 401 means the device is gone.
  private async authed(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessToken()
    const res = await this.fetch(`${this.config.serverUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}` } })
    if (res.status === 401) {
      await this.forget(SIGNED_OUT)
      throw new Error(SIGNED_OUT)
    }
    return res
  }

  private async connect() {
    if (this.stopped || !this.config.enabled || this.socket) return
    let token: string
    try {
      token = await this.accessToken()
    } catch {
      if (this.config.enabled) this.retry()
      return
    }
    // Another connect may have finished while the token was being refreshed.
    if (this.socket || !this.config.enabled) return
    const url = `${this.config.serverUrl.replace(/^http/, 'ws')}/sync`
    const ws = new this.Socket(url, ['prometheus-sync', `bearer.${token}`])
    this.socket = ws
    this.ready = false
    this.awaiting = false
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', since: this.config.lastSeq }))
      this.pingTimer = setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), this.pingMs)
    }
    ws.onmessage = ev => this.onFrame(ws, ev.data)
    ws.onclose = ev => this.onClose(ws, ev.code)
  }

  private retry() {
    const delay = Math.min(this.maxRetryMs, this.minRetryMs * 2 ** this.attempt)
    this.attempt++
    this.later('retry', delay, () => void this.connect())
  }

  private onClose(ws: SocketLike, code: number) {
    if (ws !== this.socket) return
    this.socket = null
    this.ready = false
    this.awaiting = false
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    if (code === 4001) return void this.forget(SIGNED_OUT) // the server revoked this device
    if (this.config.enabled && !this.stopped) this.retry()
  }

  private onFrame(ws: SocketLike, data: unknown) {
    if (ws !== this.socket) return
    let msg: Frame
    try {
      msg = JSON.parse(String(data)) as Frame
    } catch {
      return
    }
    switch (msg.type) {
      case 'ready':
        this.ready = true
        this.attempt = 0
        this.error = null
        if (!this.config.joined) {
          this.probeHead = msg.head
          // Nothing on the server yet, so merging is the only choice. Otherwise the user picks.
          if (msg.head === 0) {
            this.join('merge').catch(err => {
              this.error = err instanceof Error ? err.message : 'Join failed.'
            })
          }
          return
        }
        this.config.lastSeq = Math.max(this.config.lastSeq, msg.head)
        void this.save()
        return this.pump()
      case 'snapshot':
        if (this.config.joined) this.apply(msg.ops)
        return
      case 'ops':
        if (!this.config.joined) return
        this.apply(msg.ops.map(e => e.op))
        this.config.lastSeq = Math.max(this.config.lastSeq, ...msg.ops.map(e => e.seq))
        void this.save()
        return
      case 'ack': {
        const inflight = this.outbox.inflight
        if (!inflight || msg.id !== inflight.id) return
        this.outbox.ops.splice(0, inflight.count)
        this.outbox.inflight = null
        this.awaiting = false
        this.lastSync = this.now()
        this.error = null
        void this.save()
        return this.pump()
      }
      case 'error': {
        const inflight = this.outbox.inflight
        if (!inflight || msg.id !== inflight.id) {
          this.error = msg.message ?? `Server error: ${msg.code}`
          return
        }
        if (msg.code === 'skew') {
          // Keep the batch and do not resend on this connection: a retry would be rejected the same way.
          const minutes = Math.max(1, Math.round((msg.skewMs ?? 0) / 60_000))
          this.error = `This device's clock is about ${minutes} min ahead of the server. Fix the clock to resume cloud sync.`
          return
        }
        // Any other rejection would repeat forever, so drop the batch and say what was lost.
        console.error('cloud push rejected', msg.code, msg.message ?? '')
        this.outbox.ops.splice(0, inflight.count)
        this.outbox.inflight = null
        this.awaiting = false
        this.error = `${inflight.count} change(s) were rejected by the server and not synced.`
        void this.save()
        return this.pump()
      }
      case 'pong':
        return
    }
  }

  // Sends the next batch if one is not already out. The batch id is persisted, so a retry reuses it.
  private pump() {
    if (!this.socket || !this.ready || !this.config.joined || this.awaiting || this.outbox.ops.length === 0) return
    if (!this.outbox.inflight) {
      this.outbox.inflight = { id: randomUUID(), count: Math.min(MAX_BATCH, this.outbox.ops.length) }
      void this.save()
    }
    const { id, count } = this.outbox.inflight
    this.awaiting = true
    this.socket.send(JSON.stringify({ type: 'push', id, ops: this.outbox.ops.slice(0, count) }))
  }

  // Remote ops in server order. Each applies only where its hlc beats the field's clock, as in folder sync.
  private apply(ops: Op[]) {
    if (ops.length === 0) return
    for (const op of ops) this.opts.clock.observe(op.hlc)
    const result = applyOps(this.opts.hooks.read(), ops, this.opts.clocks)
    if (result.applied > 0) this.opts.hooks.write(resolveNumberClashes(ensureTeams(result.data)))
    const entries: [string, string][] = []
    for (const op of ops) {
      for (const k of opKeys(op)) {
        const hlc = this.opts.clocks.get(k)
        if (hlc) entries.push([k, hlc])
      }
    }
    void this.opts.store.setClocks(entries).catch(err => console.error('cloud clock save failed', err instanceof Error ? err.message : 'unknown'))
    this.lastSync = this.now()
  }

}
