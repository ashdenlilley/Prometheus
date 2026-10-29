import type { AppData, Comment, Issue, WebhookEvent } from './types'

// Outgoing webhook rules. Pure: no node imports, so the renderer and tests can use it.

export const WEBHOOK_EVENTS: WebhookEvent[] = ['issue.created', 'issue.updated', 'issue.deleted', 'issue.status_changed', 'comment.created']
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]
export const DELIVERY_LOG_LIMIT = 500
export const TIMEOUT_MS = 10_000

export type DeliveryStatus = 'pending' | 'delivered' | 'failed'

// One row of the local delivery queue and log. `payload` is the exact JSON body that is sent.
export interface WebhookDelivery {
  id: string
  webhookId: string
  event: WebhookEvent
  payload: string
  status: DeliveryStatus
  attempts: number
  nextAt: number
  lastCode?: number
  lastError?: string
  createdAt: string
  updatedAt: string
}

// `attempts` counts sends already made. After send n fails, retry n waits RETRY_DELAYS_MS[n-1].
export function nextAttemptAt(attempts: number, fromMs: number): number | null {
  const delay = RETRY_DELAYS_MS[attempts - 1]
  return delay === undefined ? null : fromMs + delay
}

export type UrlCheck = { ok: true } | { ok: false; reason: string }

const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '::1']

// Literal private, loopback and link-local addresses. Hostnames are not resolved here.
function privateHost(host: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  if (host.includes(':')) return host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)
  return false
}

// https is allowed. http is allowed only for loopback when allowLocal is set. Private and loopback
// hosts (including localhost) need allowLocal.
export function urlAllowed(url: string, allowLocal = false): UrlCheck {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, reason: 'Enter a valid URL' }
  }
  const host = u.hostname.replace(/^\[(.*)\]$/, '$1')
  const local = host === 'localhost' || privateHost(host)
  if (local && !allowLocal) return { ok: false, reason: 'Local and private network addresses need "allow local network"' }
  if (u.protocol === 'https:') return { ok: true }
  if (u.protocol === 'http:' && allowLocal && LOOPBACK_NAMES.includes(host)) return { ok: true }
  return { ok: false, reason: 'Only https:// URLs are allowed' }
}

export interface WebhookPayload {
  event: WebhookEvent
  at: string
  actor: string
  project: { id: string; key: string }
  issue: Issue | null
  changes?: Record<string, [unknown, unknown]>
  comment?: Comment
  test?: true
}

export interface WebhookEventOut {
  webhookId: string
  event: WebhookEvent
  payload: WebhookPayload
}

// Fields that change on every edit or are not user-visible content.
const IGNORED_FIELDS = new Set(['activity', 'comments', 'updatedAt', 'firedAutomations'])

// Events produced by one state change, one entry per (event, subscribed enabled webhook).
export function webhookEvents(prev: AppData, next: AppData, actor: string, at: string): WebhookEventOut[] {
  const hooks = (next.webhooks ?? []).filter(w => w.enabled)
  if (hooks.length === 0) return []
  const before = new Map(prev.issues.map(i => [i.id, i]))
  const after = new Map(next.issues.map(i => [i.id, i]))
  const out: WebhookEventOut[] = []

  const emit = (issue: Issue, event: WebhookEvent, extra: Pick<WebhookPayload, 'changes' | 'comment'> = {}) => {
    const project = next.projects.find(p => p.id === issue.projectId) ?? prev.projects.find(p => p.id === issue.projectId)
    const payload: WebhookPayload = {
      event,
      at,
      actor,
      project: { id: issue.projectId, key: project?.key ?? '' },
      issue,
      ...extra
    }
    for (const w of hooks) {
      if (w.projectId === issue.projectId && w.events.includes(event)) out.push({ webhookId: w.id, event, payload })
    }
  }

  for (const [id, issue] of after) {
    const old = before.get(id)
    // The reducer keeps unchanged issues as the same object, so this skips most of the comparison.
    if (old === issue) continue
    if (!old) {
      emit(issue, 'issue.created')
    } else {
      const changes = fieldChanges(old, issue)
      if (Object.keys(changes).length > 0) emit(issue, 'issue.updated', { changes })
      if (old.status !== issue.status) emit(issue, 'issue.status_changed', { changes: { status: [old.status, issue.status] } })
    }
    const seen = new Set((old?.comments ?? []).map(c => c.id))
    for (const comment of issue.comments) if (!seen.has(comment.id)) emit(issue, 'comment.created', { comment })
  }
  for (const [id, issue] of before) if (!after.has(id)) emit(issue, 'issue.deleted')
  return out
}

function fieldChanges(a: Issue, b: Issue): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (IGNORED_FIELDS.has(k)) continue
    const x = (a as unknown as Record<string, unknown>)[k]
    const y = (b as unknown as Record<string, unknown>)[k]
    if (JSON.stringify(x) !== JSON.stringify(y)) changes[k] = [x, y]
  }
  return changes
}
