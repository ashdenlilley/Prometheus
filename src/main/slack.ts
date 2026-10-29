import { isSlackWebhookUrl, type SlackMessage } from '../shared/integrations'

// Slack incoming webhooks: the per-device URL secret, the outgoing policy, and a sender with retries.
// No electron imports here, so tests can run it against a local receiver.

// Where a webhook URL lives in the per-device CredentialStore. Never in AppData.
export const webhookCredential = (integrationId: string) => `slack.webhook.${integrationId}`

// Shown in the UI instead of the URL: host plus the last four characters.
export const webhookHint = (url: string) => `${new URL(url).host}/…${url.slice(-4)}`

// Test-only: PROMETHEUS_SLACK_TEST_URL_BASE=http://127.0.0.1:<port>/ lets a local receiver stand in for Slack.
export function allowedWebhookUrl(url: string): boolean {
  if (isSlackWebhookUrl(url)) return true
  const base = process.env.PROMETHEUS_SLACK_TEST_URL_BASE
  return !!base && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(base) && url.startsWith(base)
}

export type SendResult = { ok: true } | { ok: false; status?: number; error: string }

export interface SlackJob {
  name: string // integration name, for failure notices. The URL is never shown.
  url: string
  message: SlackMessage
}

export interface SlackSenderOptions {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  maxAttempts?: number
  allow: (url: string) => boolean
  onFailure?: (failure: { name: string; error: string; at: string }) => void
}

const TIMEOUT_MS = 10_000
const MAX_RETRY_AFTER_MS = 60_000
const MAX_ERROR_CHARS = 200

export class SlackSender {
  private fetchImpl: typeof fetch
  private sleep: (ms: number) => Promise<void>
  private now: () => number
  private maxAttempts: number
  private allow: (url: string) => boolean
  private onFailure?: SlackSenderOptions['onFailure']
  // One job in flight at a time, in the order enqueued. Each job catches its own errors.
  private tail: Promise<void> = Promise.resolve()

  constructor(opts: SlackSenderOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.sleep = opts.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
    this.now = opts.now ?? Date.now
    this.maxAttempts = opts.maxAttempts ?? 4
    this.allow = opts.allow
    this.onFailure = opts.onFailure
  }

  enqueue(job: SlackJob) {
    this.tail = this.tail.then(async () => {
      const res = await this.send(job.url, job.message)
      if (!res.ok) this.onFailure?.({ name: job.name, error: res.error, at: new Date(this.now()).toISOString() })
    })
  }

  // Resolves once every job enqueued so far has finished.
  idle(): Promise<void> {
    return this.tail
  }

  async send(url: string, message: SlackMessage): Promise<SendResult> {
    // Checked before any request, so a rejected URL never leaves the machine
    if (!this.allow(url)) return { ok: false, error: 'Webhook URL is not a Slack incoming webhook' }
    for (let attempt = 1; ; attempt++) {
      const last = attempt >= this.maxAttempts
      let res: Response
      try {
        res = await this.post(url, message)
      } catch (err) {
        const error = (err as Error).name === 'AbortError' ? 'Timed out' : 'Network error'
        if (last) return { ok: false, error }
        await this.sleep(2 ** (attempt - 1) * 1000)
        continue
      }
      if (res.status === 200) {
        const body = await res.text()
        return body === 'ok' ? { ok: true } : { ok: false, status: 200, error: truncate(body) }
      }
      if (res.status === 429) {
        if (last) return { ok: false, status: 429, error: 'Rate limited' }
        await this.sleep(retryAfterMs(res.headers.get('Retry-After')))
        continue
      }
      if (res.status >= 500) {
        if (last) return { ok: false, status: res.status, error: `Slack returned ${res.status}` }
        await this.sleep(2 ** (attempt - 1) * 1000)
        continue
      }
      // Other client errors (invalid_payload, no_service, channel_is_archived...) will not succeed on retry
      return { ok: false, status: res.status, error: truncate(await res.text()) }
    }
  }

  private async post(url: string, message: SlackMessage): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        redirect: 'error',
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

function retryAfterMs(header: string | null): number {
  const seconds = Number(header)
  if (!header || !Number.isFinite(seconds) || seconds < 0) return 1000
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
}

function truncate(text: string): string {
  return text.trim().slice(0, MAX_ERROR_CHARS)
}
