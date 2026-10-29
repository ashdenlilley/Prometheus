import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { AppData } from '../shared/types'
import type { Action } from '../shared/model'
import { TIMEOUT_MS, nextAttemptAt, urlAllowed, type WebhookDelivery, type WebhookEventOut, type WebhookPayload } from '../shared/webhooks'
import type { Store } from './db'

// Outgoing webhook delivery, run in the main process. Secrets stay on this device (never in AppData).

const TICK_MS = 15_000
const SECRETS_FILE = 'webhook-secrets.json'

// Timestamped HMAC-SHA256 over `${t}.${body}`, Stripe style.
const hmac = (secret: string, timestampSec: number, body: string) =>
  createHmac('sha256', secret).update(`${timestampSec}.${body}`).digest('hex')

export function sign(secret: string, timestampSec: number, body: string): string {
  return `t=${timestampSec},v1=${hmac(secret, timestampSec, body)}`
}

// Rejects a bad signature or one whose timestamp is further than toleranceSec from nowSec.
export function verifySignature(secret: string, header: string, body: string, nowSec: number, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec) return false
  const expected = Buffer.from(hmac(secret, t, body), 'hex')
  const given = Buffer.from(parts.v1, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export const newSecret = () => `whsec_${randomBytes(32).toString('hex')}`

// Same shape as the sync key sealing in index.ts: safeStorage when available, plaintext otherwise.
export interface SecretKeys {
  seal: (text: string) => Promise<string>
  open: (sealed: string) => Promise<string | null>
}

// Per-device signing secrets, one JSON file: { [webhookId]: secret }. Values are sealed when keys are given.
export class WebhookSecrets {
  constructor(
    private dir: string,
    private keys?: SecretKeys
  ) {}

  private get file() {
    return join(this.dir, SECRETS_FILE)
  }

  private async load(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }

  private async save(map: Record<string, string>) {
    await fs.writeFile(this.file, JSON.stringify(map, null, 2), { mode: 0o600 })
  }

  // Returns the plaintext once. The stored copy is replaced, so the old secret stops verifying.
  async createSecret(id: string): Promise<string> {
    const secret = newSecret()
    const map = await this.load()
    map[id] = this.keys ? await this.keys.seal(secret) : secret
    await this.save(map)
    return secret
  }

  rotateSecret(id: string): Promise<string> {
    return this.createSecret(id)
  }

  async getSecret(id: string): Promise<string | null> {
    const stored = (await this.load())[id]
    if (stored === undefined) return null
    if (!this.keys) return stored
    try {
      return await this.keys.open(stored)
    } catch {
      return null
    }
  }

  async deleteSecret(id: string): Promise<void> {
    const map = await this.load()
    if (!(id in map)) return
    delete map[id]
    await this.save(map)
  }
}

export interface DispatcherDeps {
  store: Pick<Store, 'enqueueDelivery' | 'dueDeliveries' | 'updateDelivery' | 'listDeliveries' | 'getDelivery'>
  getSecret: (webhookId: string) => Promise<string | null>
  read: () => AppData | null
  apply: (action: Action) => void
  fetch?: typeof fetch
  now?: () => number
}

// Queue processing. A row is pending until it is delivered, or failed when the schedule runs out.
export class WebhookDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private again = false
  private fetch: typeof fetch
  private now: () => number

  constructor(private deps: DispatcherDeps) {
    this.fetch = deps.fetch ?? globalThis.fetch
    this.now = deps.now ?? Date.now
  }

  enqueue(events: WebhookEventOut[]) {
    const at = new Date(this.now()).toISOString()
    for (const e of events) this.insert(e.webhookId, e.event, JSON.stringify(e.payload), at)
  }

  // Re-queues a copy of a logged delivery. The original row stays as it was.
  redeliver(deliveryId: string): string | null {
    const row = this.deps.store.getDelivery(deliveryId)
    if (!row) return null
    return this.insert(row.webhookId, row.event, row.payload, new Date(this.now()).toISOString())
  }

  // Sends a test payload shaped like an issue.updated event, flagged with test: true.
  testSend(webhookId: string): string | null {
    const data = this.deps.read()
    const hook = data?.webhooks?.find(w => w.id === webhookId)
    if (!data || !hook) return null
    const project = data.projects.find(p => p.id === hook.projectId)
    const sample = data.issues.find(i => i.projectId === hook.projectId)
    const payload: WebhookPayload = {
      event: 'issue.updated',
      at: new Date(this.now()).toISOString(),
      actor: 'test',
      project: { id: hook.projectId, key: project?.key ?? '' },
      issue: sample ? { ...sample, key: `${project?.key ?? ''}-${sample.number}` } : null,
      changes: {},
      test: true
    }
    return this.insert(webhookId, 'issue.updated', JSON.stringify(payload), new Date(this.now()).toISOString())
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    void this.tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // Sends every due row, one at a time. Overlapping ticks are skipped.
  async tick(): Promise<void> {
    // Before the data loads, webhooks cannot be looked up. Skip rather than fail the queue.
    if (!this.deps.read()) return
    if (this.busy) {
      // Rows queued during a pass are picked up by one more pass right after it.
      this.again = true
      return
    }
    this.busy = true
    try {
      do {
        this.again = false
        for (const row of this.deps.store.dueDeliveries(this.now())) await this.attempt(row)
      } while (this.again)
    } finally {
      this.busy = false
    }
  }

  private insert(webhookId: string, event: WebhookDelivery['event'], payload: string, at: string): string {
    const row: WebhookDelivery = {
      id: randomUUID(),
      webhookId,
      event,
      payload,
      status: 'pending',
      attempts: 0,
      nextAt: this.now(),
      createdAt: at,
      updatedAt: at
    }
    this.deps.store.enqueueDelivery(row)
    return row.id
  }

  private async attempt(row: WebhookDelivery) {
    const hook = this.deps.read()?.webhooks?.find(w => w.id === row.webhookId)
    if (!hook) return this.skip(row, 'Webhook was deleted')
    if (!hook.enabled) return this.skip(row, hook.disabledReason ?? 'Webhook is disabled')
    const allowed = urlAllowed(hook.url, hook.allowLocal ?? false)
    if (!allowed.ok) return this.skip(row, allowed.reason)
    const secret = await this.deps.getSecret(hook.id)
    if (!secret) return this.skip(row, 'No signing secret on this device')

    const nowMs = this.now()
    const attempts = row.attempts + 1
    try {
      const res = await this.fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Prometheus-Event': row.event,
          'Prometheus-Delivery': row.id,
          'Prometheus-Signature': sign(secret, Math.floor(nowMs / 1000), row.payload)
        },
        body: row.payload,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      void res.body?.cancel()
      if (res.ok) return this.write({ ...row, status: 'delivered', attempts, lastCode: res.status, lastError: undefined }, nowMs)
      if (res.status === 410) {
        this.deps.apply({ type: 'patchWebhook', id: hook.id, patch: { enabled: false, disabledReason: 'Receiver returned 410' } })
        return this.write({ ...row, status: 'failed', attempts, lastCode: 410, lastError: 'Receiver returned 410' }, nowMs)
      }
      return this.retry(row, attempts, `HTTP ${res.status}`, res.status, nowMs)
    } catch (err) {
      return this.retry(row, attempts, err instanceof Error ? err.message : String(err), undefined, nowMs)
    }
  }

  private retry(row: WebhookDelivery, attempts: number, error: string, code: number | undefined, nowMs: number) {
    const next = nextAttemptAt(attempts, nowMs)
    this.write(
      next === null
        ? { ...row, status: 'failed', attempts, lastCode: code, lastError: `${error}. Retries exhausted` }
        : { ...row, status: 'pending', attempts, nextAt: next, lastCode: code, lastError: error },
      nowMs
    )
  }

  private skip(row: WebhookDelivery, reason: string) {
    this.write({ ...row, status: 'failed', lastError: reason }, this.now())
  }

  private write(row: WebhookDelivery, nowMs: number) {
    this.deps.store.updateDelivery({ ...row, updatedAt: new Date(nowMs).toISOString() })
  }
}
