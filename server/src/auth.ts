import { DurableObject } from 'cloudflare:workers'
import type { Role } from '../../src/shared/permissions'
import { hmacB64url, randomCode, randomId, sha256Hex, signAccess, timingEqual } from './crypto'
import { type Env, issuer, refreshIdleDays } from './env'
import { ipLimit } from './limits'

const WINDOW_MS = 15 * 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const LIMIT_EMAIL = 5 // per address per 15 min
const LIMIT_EMAIL_DAY = 20 // per address per 24 h
const LIMIT_GLOBAL_HOUR = 100 // emails actually sent, all addresses together
const LIMIT_GLOBAL_DAY = 300

interface Rule {
  key: string
  limit: number
  windowMs: number
}

// Env override for a global cap. A missing or invalid value keeps the default, so a typo cannot switch the cap off.
const cap = (v: string | undefined, d: number) => (v && Number(v) >= 0 ? Number(v) : d)

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, secret_hash TEXT NOT NULL,
     device_name TEXT NOT NULL, owner INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
     verified INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0)`,
  // One row per counted hit; window_ms is the rule's window, so cleanup keeps each row as long as its rule needs.
  `CREATE TABLE IF NOT EXISTS starts (key TEXT NOT NULL, at INTEGER NOT NULL, window_ms INTEGER NOT NULL DEFAULT 900000)`,
  `CREATE INDEX IF NOT EXISTS starts_key ON starts (key, at)`,
  `CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, refresh_hash TEXT UNIQUE,
     created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER)`,
  // Every refresh token already rotated away. Presenting one again means it was stolen.
  `CREATE TABLE IF NOT EXISTS retired_refresh (hash TEXT PRIMARY KEY, device_id TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
     projects TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, removed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT NOT NULL,
     role TEXT NOT NULL, projects TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
     accepted_at INTEGER, revoked_at INTEGER)`,
  // Single-use socket tickets, stored as hashes. Deleted on redeem, or by the alarm once expired.
  `CREATE TABLE IF NOT EXISTS tickets (hash TEXT PRIMARY KEY, device_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`
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

export interface Member {
  userId: string
  email: string
  name: string
  role: Role
  projects: string[]
}

// Role and project grant for an invite or a member edit. Projects are kept only for guests.
export function grant(role: unknown, projects: unknown): { role: Role; projects: string[] } | { error: string } {
  if (role !== 'member' && role !== 'viewer' && role !== 'guest') return { error: 'bad_role' }
  if (!Array.isArray(projects) || projects.length > 100 || !projects.every(p => typeof p === 'string' && p !== '')) return { error: 'bad_projects' }
  return { role: role as Role, projects: role === 'guest' ? projects : [] }
}

// One instance named 'auth'. Storage calls are synchronous, so a check and the write after it
// cannot interleave with another request (the awaits only hash or sign).
export class Auth extends DurableObject<Env> {
  private capWarnedAt = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      for (const s of SCHEMA) run(ctx.storage.sql, s)
      // Tables created before OS-360 keep their old shape, so the new column is added by hand.
      for (const t of ['devices', 'requests']) {
        if (!rows<{ name: string }>(ctx.storage.sql, `PRAGMA table_info(${t})`).some(c => c.name === 'user_id')) {
          run(ctx.storage.sql, `ALTER TABLE ${t} ADD COLUMN user_id TEXT`)
        }
      }
      // Requests written before the confirmation code existed get the new columns; old ones have no code and cannot verify.
      const requestCols = rows<{ name: string }>(ctx.storage.sql, 'PRAGMA table_info(requests)').map(c => c.name)
      for (const [name, type] of [['code_hash', 'TEXT'], ['attempts', 'INTEGER NOT NULL DEFAULT 0'], ['ip_country', 'TEXT'], ['ip_city', 'TEXT']] as const) {
        if (!requestCols.includes(name)) run(ctx.storage.sql, `ALTER TABLE requests ADD COLUMN ${name} ${type}`)
      }
      // Rate-limit rows written before per-rule windows were stored were all 15-minute rows.
      if (!rows<{ name: string }>(ctx.storage.sql, 'PRAGMA table_info(starts)').some(c => c.name === 'window_ms')) {
        run(ctx.storage.sql, 'ALTER TABLE starts ADD COLUMN window_ms INTEGER NOT NULL DEFAULT 900000')
      }
      // The owner row follows OWNER_EMAIL. Its id is fixed, so there is never a second owner.
      const email = (env.OWNER_EMAIL ?? '').trim().toLowerCase()
      run(
        ctx.storage.sql,
        "INSERT INTO users (id, email, name, role, created_at) VALUES ('owner', ?, ?, 'owner', ?) ON CONFLICT (id) DO UPDATE SET email = excluded.email",
        email,
        email.split('@')[0],
        Date.now()
      )
      if (!(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(Date.now() + HOUR)
    })
  }

  private get sql() {
    return this.ctx.storage.sql
  }

  // Counts one hit on every rule and returns seconds until retry, or 0 when every rule is under its limit
  // (then nothing is recorded for the rules that were checked). Counts run before any await, so concurrent calls cannot slip past a limit.
  private hit(rules: Rule[]): number {
    const now = Date.now()
    let retry = 0
    for (const r of rules) {
      const hits = rows<{ n: number; first: number | null }>(this.sql, 'SELECT COUNT(*) AS n, MIN(at) AS first FROM starts WHERE key = ? AND at > ?', r.key, now - r.windowMs)[0]
      if (hits.n >= r.limit) retry = Math.max(retry, Math.ceil(((hits.first ?? now) + r.windowMs - now) / 1000))
    }
    if (retry) return retry
    for (const r of rules) run(this.sql, 'INSERT INTO starts (key, at, window_ms) VALUES (?, ?, ?)', r.key, now, r.windowMs)
    run(this.sql, 'DELETE FROM starts WHERE at + window_ms < ?', now)
    return 0
  }

  // Counts one email about to be sent against the global caps. Returns seconds until retry, or 0 when sending is allowed.
  private emailRetry(): number {
    const retry = this.hit([
      { key: 'sent:hour', limit: cap(this.env.EMAIL_CAP_HOUR, LIMIT_GLOBAL_HOUR), windowMs: HOUR },
      { key: 'sent:day', limit: cap(this.env.EMAIL_CAP_DAY, LIMIT_GLOBAL_DAY), windowMs: DAY }
    ])
    if (retry && Date.now() - this.capWarnedAt > HOUR) {
      this.capWarnedAt = Date.now()
      console.warn('email cap reached')
    }
    return retry
  }

  // Non-members get no row. Their requestId and pollSecret are HMACs of the start time (see unknownPoll), so the reply
  // and the poll look the same as a member's. Non-members are never emailed, and the same hashes and random values are computed for both.
  // A member whose email would pass the global caps gets a token. Over a cap, they get the same reply with no email.
  async startSignIn(i: { emailKey: string; email: string; ip: string; deviceName: string; country: string | null; city: string | null }) {
    const retry = this.hit([
      { key: `email:${i.emailKey}`, limit: LIMIT_EMAIL, windowMs: WINDOW_MS },
      { key: `email-day:${i.emailKey}`, limit: LIMIT_EMAIL_DAY, windowMs: DAY },
      { key: `ip:${i.ip}`, limit: ipLimit(i.ip), windowMs: WINDOW_MS }
    ])
    if (retry) return { limited: retry }

    const now = Date.now()
    const user = rows<{ id: string }>(this.sql, 'SELECT id FROM users WHERE email = ? AND removed_at IS NULL', i.email)[0]
    const sent = user !== undefined && this.emailRetry() === 0
    const expiresAt = now + Number(this.env.LINK_TTL_SECONDS ?? 900) * 1000
    const secret = this.env.JWT_SECRET ?? ''
    const rand = randomId(16)
    const requestId = `${rand}.${now}.${await hmacB64url(secret, `req:${rand}.${now}`)}`
    const pollSecret = await hmacB64url(secret, `poll:${requestId}`)
    const token = randomId(32)
    const code = randomCode()
    if (user) {
      run(
        this.sql,
        'INSERT INTO requests (id, token_hash, secret_hash, device_name, owner, created_at, expires_at, user_id, code_hash, ip_country, ip_city) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        requestId,
        await sha256Hex(token),
        await sha256Hex(pollSecret),
        i.deviceName,
        1,
        now,
        expiresAt,
        user.id,
        await sha256Hex(code),
        i.country,
        i.city
      )
    } else {
      await Promise.all([sha256Hex(token), sha256Hex(pollSecret), sha256Hex(code)])
    }
    return { requestId, pollSecret, expiresAt, code, token: sent ? token : null }
  }

  // A request id with no row is a non-member's, or an expired member's row that prune() removed. Its id is
  // `<rand>.<startedMs>.<hmac>` and its pollSecret is an HMAC of the id, so it can be checked without storage.
  private async unknownPoll(requestId: string, secretHash: string): Promise<PollResult> {
    const parts = requestId.split('.')
    if (parts.length !== 3 || !/^\d+$/.test(parts[1])) return { status: 'notfound' }
    const [rand, ms, sig] = parts
    const secret = this.env.JWT_SECRET ?? ''
    if (!timingEqual(sig, await hmacB64url(secret, `req:${rand}.${ms}`))) return { status: 'notfound' }
    if (!timingEqual(await sha256Hex(await hmacB64url(secret, `poll:${requestId}`)), secretHash)) return { status: 'notfound' }
    return Date.now() < Number(ms) + Number(this.env.LINK_TTL_SECONDS ?? 900) * 1000 ? { status: 'pending' } : { status: 'gone' }
  }

  // The request behind an emailed link, for the confirm page. Does not consume it.
  async linkInfo(tokenHash: string) {
    const r = rows<{ device_name: string; ip_country: string | null; ip_city: string | null; created_at: number }>(
      this.sql,
      'SELECT device_name, ip_country, ip_city, created_at FROM requests WHERE token_hash = ? AND owner = 1 AND verified = 0 AND expires_at > ?',
      tokenHash,
      Date.now()
    )[0]
    return r ? { deviceName: r.device_name, country: r.ip_country, city: r.ip_city, startedAt: r.created_at } : null
  }

  // Verifies only when the code matches. A miss counts as an attempt; the fifth miss burns the request.
  async verifyLink(tokenHash: string, codeHash: string): Promise<boolean> {
    const hit = rows<{ id: string; code_hash: string }>(
      this.sql,
      "SELECT id, COALESCE(code_hash, '') AS code_hash FROM requests WHERE token_hash = ? AND owner = 1 AND verified = 0 AND expires_at > ?",
      tokenHash,
      Date.now()
    )[0]
    if (!hit) return false
    if (timingEqual(hit.code_hash, codeHash)) {
      run(this.sql, 'UPDATE requests SET verified = 1 WHERE id = ?', hit.id)
      return true
    }
    run(this.sql, 'UPDATE requests SET attempts = attempts + 1, expires_at = CASE WHEN attempts + 1 >= 5 THEN 0 ELSE expires_at END WHERE id = ?', hit.id)
    return false
  }

  async poll(requestId: string, secretHash: string): Promise<PollResult> {
    const r = rows<{ secret_hash: string; device_name: string; verified: number; consumed: number; expires_at: number; user_id: string }>(
      this.sql,
      "SELECT secret_hash, device_name, verified, consumed, expires_at, COALESCE(user_id, 'owner') AS user_id FROM requests WHERE id = ?",
      requestId
    )[0]
    if (!r) return this.unknownPoll(requestId, secretHash)
    if (!timingEqual(r.secret_hash, secretHash)) return { status: 'notfound' }
    if (r.consumed) return { status: 'gone' }
    if (!r.verified) return r.expires_at > Date.now() ? { status: 'pending' } : { status: 'gone' }

    // Consume before the first await so a concurrent poll cannot get a second session.
    run(this.sql, 'UPDATE requests SET consumed = 1 WHERE id = ?', requestId)
    const now = Date.now()
    const deviceId = randomId(16)
    const refreshToken = randomId(32)
    run(
      this.sql,
      'INSERT INTO devices (id, name, refresh_hash, created_at, last_seen_at, user_id) VALUES (?, ?, ?, ?, ?, ?)',
      deviceId,
      r.device_name,
      await sha256Hex(refreshToken),
      now,
      now,
      r.user_id
    )
    const access = await signAccess(this.env.JWT_SECRET ?? '', { iss: issuer(this.env), userId: r.user_id, deviceId }) // the Worker checks JWT_SECRET is set
    return { status: 'ok', refreshToken, deviceId, ...access }
  }

  // Rotates the refresh token. Reusing a retired one revokes its device.
  async refresh(refreshToken: string) {
    const hash = await sha256Hex(refreshToken)
    const next = randomId(32)
    const nextHash = await sha256Hex(next)
    const now = Date.now()
    const d = rows<{ id: string; user_id: string; last_seen_at: number }>(
      this.sql,
      "SELECT id, COALESCE(user_id, 'owner') AS user_id, last_seen_at FROM devices WHERE refresh_hash = ? AND revoked_at IS NULL",
      hash
    )[0]
    if (!d) {
      const old = rows<{ device_id: string }>(this.sql, 'SELECT device_id FROM retired_refresh WHERE hash = ?', hash)[0]
      if (old) await this.revoke([old.device_id])
      return null
    }
    // A device idle for longer than REFRESH_IDLE_DAYS (default 60) must sign in again.
    if (d.last_seen_at < now - refreshIdleDays(this.env) * DAY) {
      await this.revoke([d.id])
      return null
    }
    run(this.sql, 'UPDATE devices SET refresh_hash = ?, last_seen_at = ? WHERE id = ?', nextHash, now, d.id)
    run(this.sql, 'INSERT INTO retired_refresh (hash, device_id, at) VALUES (?, ?, ?)', hash, d.id, now)
    const access = await signAccess(this.env.JWT_SECRET ?? '', { iss: issuer(this.env), userId: d.user_id, deviceId: d.id })
    return { refreshToken: next, deviceId: d.id, ...access }
  }

  // The device's member when the device and its user are both active. Also records that the device was seen.
  async authorize(deviceId: string): Promise<Member | null> {
    const m = rows<{ id: string; email: string; name: string; role: string; projects: string }>(
      this.sql,
      "SELECT u.id, u.email, u.name, u.role, u.projects FROM devices d JOIN users u ON u.id = COALESCE(d.user_id, 'owner') WHERE d.id = ? AND d.revoked_at IS NULL AND u.removed_at IS NULL",
      deviceId
    )[0]
    if (!m) return null
    run(this.sql, 'UPDATE devices SET last_seen_at = ? WHERE id = ?', Date.now(), deviceId)
    return { userId: m.id, email: m.email, name: m.name, role: m.role as Role, projects: JSON.parse(m.projects) }
  }

  // Single-use sync ticket for a device. Only its hash is stored.
  async createTicket(deviceId: string): Promise<string> {
    const ticket = randomId(32)
    run(this.sql, 'INSERT INTO tickets (hash, device_id, expires_at) VALUES (?, ?, ?)', await sha256Hex(ticket), deviceId, Date.now() + Number(this.env.SYNC_TICKET_TTL_SECONDS ?? 60) * 1000)
    return ticket
  }

  // The delete runs before any other step, so a second redeem of the same ticket finds no row.
  async redeemTicket(hash: string): Promise<{ dev: string; member: Member } | null> {
    const t = rows<{ device_id: string; expires_at: number }>(this.sql, 'DELETE FROM tickets WHERE hash = ? RETURNING device_id, expires_at', hash)[0]
    if (!t || t.expires_at <= Date.now()) return null
    const member = await this.authorize(t.device_id)
    return member ? { dev: t.device_id, member } : null
  }

  async listDevices(currentId: string, userId: string) {
    return rows<{ id: string; name: string; created_at: number; last_seen_at: number }>(
      this.sql,
      "SELECT id, name, created_at, last_seen_at FROM devices WHERE revoked_at IS NULL AND COALESCE(user_id, 'owner') = ? ORDER BY created_at",
      userId
    ).map(d => ({ id: d.id, name: d.name, createdAt: d.created_at, lastSeenAt: d.last_seen_at, current: d.id === currentId }))
  }

  async revokeDevice(deviceId: string, userId: string): Promise<boolean> {
    if (!rows<{ id: string }>(this.sql, "SELECT id FROM devices WHERE id = ? AND revoked_at IS NULL AND COALESCE(user_id, 'owner') = ?", deviceId, userId)[0]) return false
    await this.revoke([deviceId])
    return true
  }

  async revokeAll(userId: string): Promise<number> {
    const ids = this.deviceIds(userId)
    await this.revoke(ids)
    return ids.length
  }

  private deviceIds(userId: string): string[] {
    return rows<{ id: string }>(this.sql, "SELECT id FROM devices WHERE revoked_at IS NULL AND COALESCE(user_id, 'owner') = ?", userId).map(d => d.id)
  }

  // Revoked devices lose their refresh token at once, and their open sockets are closed by Workspace.
  private async revoke(ids: string[]) {
    for (const id of ids) run(this.sql, 'UPDATE devices SET revoked_at = ?, refresh_hash = NULL WHERE id = ? AND revoked_at IS NULL', Date.now(), id)
    if (ids.length) await this.env.WORKSPACE.getByName('default').closeDevices(ids)
  }

  // Invites are created by the owner. Expiry and the rate limits come from the same clock as sign-in.
  async createInvite(i: { emailKey: string; email: string; name: string; role: unknown; projects: unknown; ip: string }) {
    const g = grant(i.role, i.projects)
    if ('error' in g) return g
    // The token is hashed before the synchronous block, so the checks and writes below cannot interleave.
    const token = randomId(32)
    const tokenHash = await sha256Hex(token)
    const retry = this.hit([
      { key: `invite:${i.emailKey}`, limit: LIMIT_EMAIL, windowMs: WINDOW_MS },
      { key: `invite-ip:${i.ip}`, limit: ipLimit(i.ip), windowMs: WINDOW_MS }
    ])
    if (retry) return { limited: retry }
    if (rows<{ id: string }>(this.sql, 'SELECT id FROM users WHERE email = ? AND removed_at IS NULL', i.email)[0]) return { error: 'already_member' }
    // The invite email is an email too. Over a global cap, no invite is stored.
    const capped = this.emailRetry()
    if (capped) return { limited: capped }

    const now = Date.now()
    // Only the newest invite for an address works.
    run(this.sql, 'UPDATE invites SET revoked_at = ? WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL', now, i.email)
    const id = randomId(12)
    const expiresAt = now + Number(this.env.INVITE_TTL_SECONDS ?? 7 * 86400) * 1000
    run(
      this.sql,
      'INSERT INTO invites (id, token_hash, email, name, role, projects, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      tokenHash,
      i.email,
      i.name,
      g.role,
      JSON.stringify(g.projects),
      now,
      expiresAt
    )
    return { id, token, expiresAt }
  }

  // The pending invite behind a token, or null. Does not consume it.
  async inviteInfo(tokenHash: string) {
    return (
      rows<{ email: string; name: string; role: string }>(
        this.sql,
        'SELECT email, name, role FROM invites WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?',
        tokenHash,
        Date.now()
      )[0] ?? null
    )
  }

  // Single use: marks the invite accepted and adds the user (or reactivates a removed one).
  async acceptInvite(tokenHash: string): Promise<{ email: string } | null> {
    const now = Date.now()
    const inv = rows<{ id: string; email: string; name: string; role: string; projects: string }>(
      this.sql,
      'SELECT id, email, name, role, projects FROM invites WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?',
      tokenHash,
      now
    )[0]
    if (!inv) return null
    run(this.sql, 'UPDATE invites SET accepted_at = ? WHERE id = ?', now, inv.id)
    const user = rows<{ id: string }>(this.sql, 'SELECT id FROM users WHERE email = ?', inv.email)[0]
    if (user) {
      run(this.sql, 'UPDATE users SET name = ?, role = ?, projects = ?, removed_at = NULL WHERE id = ? AND id <> \'owner\'', inv.name, inv.role, inv.projects, user.id)
    } else {
      run(this.sql, 'INSERT INTO users (id, email, name, role, projects, created_at) VALUES (?, ?, ?, ?, ?, ?)', randomId(12), inv.email, inv.name, inv.role, inv.projects, now)
    }
    return { email: inv.email }
  }

  async listMembers() {
    const members = rows<{ id: string; email: string; name: string; role: string; projects: string; created_at: number }>(
      this.sql,
      'SELECT id, email, name, role, projects, created_at FROM users WHERE removed_at IS NULL ORDER BY created_at'
    ).map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, projects: JSON.parse(u.projects), createdAt: u.created_at }))
    const invites = rows<{ id: string; email: string; name: string; role: string; projects: string; expires_at: number }>(
      this.sql,
      'SELECT id, email, name, role, projects, expires_at FROM invites WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at',
      Date.now()
    ).map(v => ({ id: v.id, email: v.email, name: v.name, role: v.role, projects: JSON.parse(v.projects), expiresAt: v.expires_at }))
    return { members, invites }
  }

  // false: no such member (or the owner). { error }: the new role or projects are not allowed. true: saved and their sockets closed.
  async updateMember(id: string, p: { role?: unknown; projects?: unknown; name?: string }): Promise<boolean | { error: string }> {
    const u = rows<{ role: string; projects: string; name: string }>(this.sql, 'SELECT role, projects, name FROM users WHERE id = ? AND removed_at IS NULL', id)[0]
    if (id === 'owner' || !u) return false
    const g = grant(p.role ?? u.role, p.projects ?? JSON.parse(u.projects))
    if ('error' in g) return g
    run(this.sql, 'UPDATE users SET role = ?, projects = ?, name = ? WHERE id = ?', g.role, JSON.stringify(g.projects), p.name ?? u.name, id)
    await this.env.WORKSPACE.getByName('default').closeUser(id, 4003, 'access changed')
    return true
  }

  // Signs the member out everywhere and drops their pending invites. The owner cannot be removed.
  async removeMember(id: string): Promise<boolean> {
    if (id === 'owner' || !rows<{ id: string }>(this.sql, 'SELECT id FROM users WHERE id = ? AND removed_at IS NULL', id)[0]) return false
    run(this.sql, 'UPDATE users SET removed_at = ? WHERE id = ?', Date.now(), id)
    run(this.sql, 'UPDATE invites SET revoked_at = ? WHERE accepted_at IS NULL AND revoked_at IS NULL AND email = (SELECT email FROM users WHERE id = ?)', Date.now(), id)
    await this.revoke(this.deviceIds(id))
    return true
  }

  async revokeInvite(id: string): Promise<boolean> {
    return rows<{ id: string }>(this.sql, 'UPDATE invites SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id', Date.now(), id).length > 0
  }

  // Cleans expired sign-in requests and sync tickets, old rate-limit rows, retired refresh tokens and long-expired invites.
  async alarm() {
    this.prune()
    await this.ctx.storage.setAlarm(Date.now() + HOUR)
  }

  // Hourly cleanup, run by alarm(). Public so tests can run it (alarm() is reserved and not callable over RPC).
  prune() {
    const now = Date.now()
    run(this.sql, 'DELETE FROM requests WHERE expires_at < ?', now - DAY)
    run(this.sql, 'DELETE FROM requests WHERE verified = 0 AND expires_at < ?', now)
    run(this.sql, 'DELETE FROM tickets WHERE expires_at <= ?', now)
    run(this.sql, 'DELETE FROM starts WHERE at + window_ms < ?', now)
    run(this.sql, 'DELETE FROM retired_refresh WHERE at < ?', now - 90 * DAY)
    run(this.sql, 'DELETE FROM invites WHERE expires_at < ?', now - 30 * DAY)
  }
}
