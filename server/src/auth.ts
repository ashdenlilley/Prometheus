import { DurableObject } from 'cloudflare:workers'
import { randomId, sha256Hex, signAccess, timingEqual } from './crypto'
import type { Env } from './env'

const WINDOW_MS = 15 * 60_000
const LIMIT_EMAIL = 5
const LIMIT_IP = 20
const HOUR = 3_600_000
const DAY = 86_400_000

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, secret_hash TEXT NOT NULL,
     device_name TEXT NOT NULL, owner INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
     verified INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS starts (key TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS starts_key ON starts (key, at)`,
  `CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, refresh_hash TEXT UNIQUE,
     created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER)`,
  // Every refresh token already rotated away. Presenting one again means it was stolen.
  `CREATE TABLE IF NOT EXISTS retired_refresh (hash TEXT PRIMARY KEY, device_id TEXT NOT NULL, at INTEGER NOT NULL)`
]

type Sql = SqlStorage
const rows = <T extends Record<string, SqlStorageValue>>(sql: Sql, text: string, ...params: SqlStorageValue[]) =>
  sql.exec<T>(text, ...params).toArray()
const run = (sql: Sql, text: string, ...params: SqlStorageValue[]) => {
  sql.exec(text, ...params).toArray()
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'gone' }
  | { status: 'notfound' }
  | { status: 'ok'; refreshToken: string; accessToken: string; accessExpiresAt: number; deviceId: string }

// One instance named 'auth'. Storage calls are synchronous, so a check and the write after it
// cannot interleave with another request (the awaits only hash or sign).
export class Auth extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      for (const s of SCHEMA) run(ctx.storage.sql, s)
      if (!(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(Date.now() + HOUR)
    })
  }

  private get sql() {
    return this.ctx.storage.sql
  }

  // Rate-limit counts run before any await, so concurrent starts cannot slip past the limit.
  async startSignIn(i: { emailKey: string; ip: string; owner: boolean; deviceName: string }) {
    const now = Date.now()
    const keys = [`email:${i.emailKey}`, `ip:${i.ip}`]
    const limits = [LIMIT_EMAIL, LIMIT_IP]
    let retry = 0
    for (let n = 0; n < keys.length; n++) {
      const hits = rows<{ n: number; first: number | null }>(this.sql, 'SELECT COUNT(*) AS n, MIN(at) AS first FROM starts WHERE key = ? AND at > ?', keys[n], now - WINDOW_MS)[0]
      if (hits.n >= limits[n]) retry = Math.max(retry, Math.ceil(((hits.first ?? now) + WINDOW_MS - now) / 1000))
    }
    if (retry) return { limited: retry }
    for (const key of keys) run(this.sql, 'INSERT INTO starts (key, at) VALUES (?, ?)', key, now)
    run(this.sql, 'DELETE FROM starts WHERE at < ?', now - WINDOW_MS)

    // Non-owner requests are stored too, so the reply and poll look the same. They are never emailed.
    const expiresAt = now + Number(this.env.LINK_TTL_SECONDS ?? 900) * 1000
    const requestId = randomId(16)
    const pollSecret = randomId(32)
    const token = randomId(32)
    run(
      this.sql,
      'INSERT INTO requests (id, token_hash, secret_hash, device_name, owner, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      requestId,
      await sha256Hex(token),
      await sha256Hex(pollSecret),
      i.deviceName,
      i.owner ? 1 : 0,
      now,
      expiresAt
    )
    return { requestId, pollSecret, expiresAt, token: i.owner ? token : null }
  }

  async verifyLink(tokenHash: string): Promise<boolean> {
    const hit = rows<{ id: string }>(this.sql, 'SELECT id FROM requests WHERE token_hash = ? AND owner = 1 AND verified = 0 AND expires_at > ?', tokenHash, Date.now())[0]
    if (!hit) return false
    run(this.sql, 'UPDATE requests SET verified = 1 WHERE id = ?', hit.id)
    return true
  }

  async poll(requestId: string, secretHash: string): Promise<PollResult> {
    const r = rows<{ secret_hash: string; device_name: string; verified: number; consumed: number; expires_at: number }>(
      this.sql,
      'SELECT secret_hash, device_name, verified, consumed, expires_at FROM requests WHERE id = ?',
      requestId
    )[0]
    if (!r || !timingEqual(r.secret_hash, secretHash)) return { status: 'notfound' }
    if (r.consumed) return { status: 'gone' }
    if (!r.verified) return r.expires_at > Date.now() ? { status: 'pending' } : { status: 'gone' }

    // Consume before the first await so a concurrent poll cannot get a second session.
    run(this.sql, 'UPDATE requests SET consumed = 1 WHERE id = ?', requestId)
    const now = Date.now()
    const deviceId = randomId(16)
    const refreshToken = randomId(32)
    run(
      this.sql,
      'INSERT INTO devices (id, name, refresh_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
      deviceId,
      r.device_name,
      await sha256Hex(refreshToken),
      now,
      now
    )
    const access = await signAccess(this.env.JWT_SECRET ?? '', deviceId) // the Worker checks JWT_SECRET is set
    return { status: 'ok', refreshToken, deviceId, ...access }
  }

  // Rotates the refresh token. Reusing a retired one revokes its device.
  async refresh(refreshToken: string) {
    const hash = await sha256Hex(refreshToken)
    const next = randomId(32)
    const nextHash = await sha256Hex(next)
    const now = Date.now()
    const d = rows<{ id: string }>(this.sql, 'SELECT id FROM devices WHERE refresh_hash = ? AND revoked_at IS NULL', hash)[0]
    if (!d) {
      const old = rows<{ device_id: string }>(this.sql, 'SELECT device_id FROM retired_refresh WHERE hash = ?', hash)[0]
      if (old) await this.revoke([old.device_id])
      return null
    }
    run(this.sql, 'UPDATE devices SET refresh_hash = ?, last_seen_at = ? WHERE id = ?', nextHash, now, d.id)
    run(this.sql, 'INSERT INTO retired_refresh (hash, device_id, at) VALUES (?, ?, ?)', hash, d.id, now)
    const access = await signAccess(this.env.JWT_SECRET ?? '', d.id)
    return { refreshToken: next, deviceId: d.id, ...access }
  }

  // True when the device exists and is not revoked. Also records that it was seen.
  async authorize(deviceId: string): Promise<boolean> {
    const ok = rows<{ id: string }>(this.sql, 'SELECT id FROM devices WHERE id = ? AND revoked_at IS NULL', deviceId)[0]
    if (ok) run(this.sql, 'UPDATE devices SET last_seen_at = ? WHERE id = ?', Date.now(), deviceId)
    return ok !== undefined
  }

  async listDevices(currentId: string) {
    return rows<{ id: string; name: string; created_at: number; last_seen_at: number }>(
      this.sql,
      'SELECT id, name, created_at, last_seen_at FROM devices WHERE revoked_at IS NULL ORDER BY created_at'
    ).map(d => ({ id: d.id, name: d.name, createdAt: d.created_at, lastSeenAt: d.last_seen_at, current: d.id === currentId }))
  }

  async revokeDevice(deviceId: string): Promise<boolean> {
    if (!rows<{ id: string }>(this.sql, 'SELECT id FROM devices WHERE id = ? AND revoked_at IS NULL', deviceId)[0]) return false
    await this.revoke([deviceId])
    return true
  }

  async revokeAll(): Promise<number> {
    const ids = rows<{ id: string }>(this.sql, 'SELECT id FROM devices WHERE revoked_at IS NULL').map(d => d.id)
    await this.revoke(ids)
    return ids.length
  }

  // Revoked devices lose their refresh token at once, and their open sockets are closed by Workspace.
  private async revoke(ids: string[]) {
    for (const id of ids) run(this.sql, 'UPDATE devices SET revoked_at = ?, refresh_hash = NULL WHERE id = ? AND revoked_at IS NULL', Date.now(), id)
    if (ids.length) await this.env.WORKSPACE.getByName('default').closeDevices(ids)
  }

  // Cleans expired sign-in requests, old rate-limit rows and retired refresh tokens.
  async alarm() {
    const now = Date.now()
    run(this.sql, 'DELETE FROM requests WHERE expires_at < ?', now - DAY)
    run(this.sql, 'DELETE FROM starts WHERE at < ?', now - WINDOW_MS)
    run(this.sql, 'DELETE FROM retired_refresh WHERE at < ?', now - 90 * DAY)
    await this.ctx.storage.setAlarm(now + HOUR)
  }
}
