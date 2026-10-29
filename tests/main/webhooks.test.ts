import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebhookDispatcher, WebhookSecrets, sign, verifySignature, type SecretKeys } from '../../src/main/webhooks'
import { Store } from '../../src/main/db'
import { reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import { RETRY_DELAYS_MS, type WebhookEventOut } from '../../src/shared/webhooks'
import type { AppData } from '../../src/shared/types'

const T0 = Date.parse('2026-10-30T00:00:00.000Z')
const SECRET = 'whsec_test'

function fixture(): AppData {
  const data = emptyData()
  data.spaces.push({ id: 'space-1', name: 'Work', color: '#5e6ad2' })
  data.projects.push(blankProject({ id: 'proj-1', spaceId: 'space-1', name: 'Prometheus', key: 'PRM', color: '#5e6ad2' }))
  data.webhooks = [
    // allowLocal, so the tests can point at the local receiver.
    { id: 'wh-1', projectId: 'proj-1', url: '', events: ['issue.created'], enabled: true, allowLocal: true, createdAt: new Date(T0).toISOString() }
  ]
  return data
}

const event = (): WebhookEventOut => ({
  webhookId: 'wh-1',
  event: 'issue.created',
  payload: {
    event: 'issue.created',
    at: new Date(T0).toISOString(),
    actor: 'me',
    project: { id: 'proj-1', key: 'PRM' },
    issue: null
  }
})

interface Received {
  headers: http.IncomingHttpHeaders
  body: string
}

// A real local receiver. `respond` picks the status for each request, counting from 1.
async function receiver(respond: (n: number) => number = () => 200) {
  const received: Received[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      received.push({ headers: req.headers, body })
      res.writeHead(respond(received.length)).end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as { port: number }
  const close = () =>
    new Promise<void>(resolve => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  return { received, url: `http://127.0.0.1:${port}/hook`, close }
}

// Store, dispatcher and a clock the test controls. `url` defaults to a real receiver when given.
async function harness(opts: { url?: string; fetch?: typeof fetch; secret?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'webhooks-'))
  const store = new Store(join(dir, 'deliveries.db'))
  await store.open()
  const state = { data: fixture() }
  if (opts.url) state.data = { ...state.data, webhooks: [{ ...state.data.webhooks![0], url: opts.url }] }
  const clock = { now: T0 }
  const secret = opts.secret === undefined ? SECRET : opts.secret
  const dispatcher = new WebhookDispatcher({
    store,
    getSecret: async () => secret,
    read: () => state.data,
    apply: a => {
      state.data = reducer(state.data, a)
    },
    fetch: opts.fetch,
    now: () => clock.now
  })
  const cleanup = async () => {
    await store.settled()
    rmSync(dir, { recursive: true, force: true })
  }
  return { store, dispatcher, state, clock, cleanup }
}

describe('sign and verifySignature', () => {
  test('sign matches an HMAC computed independently', () => {
    const expected = createHmac('sha256', 'whsec_test').update('1700000000.{"a":1}').digest('hex')
    assert.equal(sign('whsec_test', 1700000000, '{"a":1}'), `t=1700000000,v1=${expected}`)
  })

  test('accepts a fresh, untampered signature', () => {
    const header = sign(SECRET, 1000, '{"ok":true}')
    assert.equal(verifySignature(SECRET, header, '{"ok":true}', 1000), true)
  })

  test('rejects a tampered body, a wrong secret or a malformed header', () => {
    const header = sign(SECRET, 1000, '{"ok":true}')
    assert.equal(verifySignature(SECRET, header, '{"ok":false}', 1000), false)
    assert.equal(verifySignature('whsec_other', header, '{"ok":true}', 1000), false)
    assert.equal(verifySignature(SECRET, 'garbage', '{"ok":true}', 1000), false)
  })

  test('rejects timestamps more than the tolerance away, either way', () => {
    const header = sign(SECRET, 1000, '{}')
    assert.equal(verifySignature(SECRET, header, '{}', 1300), true)
    assert.equal(verifySignature(SECRET, header, '{}', 1301), false)
    assert.equal(verifySignature(SECRET, header, '{}', 699), false)
  })
})

describe('WebhookDispatcher', () => {
  test('delivers a signed POST that the receiver can verify', async () => {
    const rx = await receiver()
    const h = await harness({ url: rx.url })
    try {
      h.dispatcher.enqueue([event()])
      await h.dispatcher.tick()
      const [row] = h.store.listDeliveries('wh-1')
      assert.equal(row.status, 'delivered')
      assert.equal(row.lastCode, 200)
      const [got] = rx.received
      assert.equal(got.headers['content-type'], 'application/json')
      assert.equal(got.headers['prometheus-event'], 'issue.created')
      assert.equal(got.headers['prometheus-delivery'], row.id)
      assert.equal(got.body, row.payload)
      assert.equal(verifySignature(SECRET, got.headers['prometheus-signature'] as string, got.body, T0 / 1000), true)
    } finally {
      await rx.close()
      await h.cleanup()
    }
  })

  test('rows queued while a pass is running are sent by a follow-up pass', async () => {
    const rx = await receiver()
    const h = await harness({ url: rx.url })
    try {
      h.dispatcher.enqueue([event()])
      const first = h.dispatcher.tick()
      h.dispatcher.enqueue([event()])
      await h.dispatcher.tick() // busy: only flags another pass
      await first
      assert.deepEqual(h.store.listDeliveries('wh-1').map(r => r.status), ['delivered', 'delivered'])
    } finally {
      await rx.close()
      await h.cleanup()
    }
  })

  test('a 500 is retried after the schedule, and a later 200 marks it delivered', async () => {
    const rx = await receiver(n => (n === 1 ? 500 : 200))
    const h = await harness({ url: rx.url })
    try {
      h.dispatcher.enqueue([event()])
      await h.dispatcher.tick()
      let [row] = h.store.listDeliveries('wh-1')
      assert.equal(row.status, 'pending')
      assert.equal(row.attempts, 1)
      assert.equal(row.nextAt, T0 + RETRY_DELAYS_MS[0])

      // Not due yet: nothing is sent.
      await h.dispatcher.tick()
      assert.equal(rx.received.length, 1)

      h.clock.now = T0 + RETRY_DELAYS_MS[0]
      await h.dispatcher.tick()
      ;[row] = h.store.listDeliveries('wh-1')
      assert.equal(rx.received.length, 2)
      assert.equal(row.status, 'delivered')
      assert.equal(row.attempts, 2)
    } finally {
      await rx.close()
      await h.cleanup()
    }
  })

  test('a 410 disables the webhook and fails the delivery', async () => {
    const rx = await receiver(() => 410)
    const h = await harness({ url: rx.url })
    try {
      h.dispatcher.enqueue([event()])
      await h.dispatcher.tick()
      const [row] = h.store.listDeliveries('wh-1')
      assert.equal(row.status, 'failed')
      assert.equal(row.lastCode, 410)
      const hook = h.state.data.webhooks![0]
      assert.equal(hook.enabled, false)
      assert.equal(hook.disabledReason, 'Receiver returned 410')
    } finally {
      await rx.close()
      await h.cleanup()
    }
  })

  test('a network error schedules a retry', async () => {
    const h = await harness({
      url: 'http://127.0.0.1:9/hook',
      fetch: async () => {
        throw new TypeError('fetch failed')
      }
    })
    try {
      h.dispatcher.enqueue([event()])
      await h.dispatcher.tick()
      const [row] = h.store.listDeliveries('wh-1')
      assert.equal(row.status, 'pending')
      assert.equal(row.attempts, 1)
      assert.equal(row.lastError, 'fetch failed')
      assert.equal(row.nextAt, T0 + RETRY_DELAYS_MS[0])
    } finally {
      await h.cleanup()
    }
  })

  // The 10 s AbortSignal.timeout is not waited for; the error it raises goes down the same path.
  test('a timeout error is treated like any other failure and retried', async () => {
    const h = await harness({
      url: 'https://example.com/hook',
      fetch: async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      }
    })
    try {
      h.dispatcher.enqueue([event()])
      await h.dispatcher.tick()
      const [row] = h.store.listDeliveries('wh-1')
      assert.equal(row.status, 'pending')
      assert.equal(row.lastError, 'The operation timed out.')
    } finally {
      await h.cleanup()
    }
  })

  test('gives up as failed once the retry schedule is exhausted', async () => {
    const rx = await receiver(() => 500)
    const h = await harness({ url: rx.url })
    try {
      h.dispatcher.enqueue([event()])
      await h.dispatcher.tick()
      for (const delay of RETRY_DELAYS_MS) {
        h.clock.now += delay
        await h.dispatcher.tick()
      }
      const [row] = h.store.listDeliveries('wh-1')
      assert.equal(row.status, 'failed')
      assert.equal(row.attempts, RETRY_DELAYS_MS.length + 1)
      assert.match(row.lastError ?? '', /Retries exhausted/)
      assert.equal(rx.received.length, RETRY_DELAYS_MS.length + 1)
    } finally {
      await rx.close()
      await h.cleanup()
    }
  })

  test('a missing secret on this device fails the delivery without sending', async () => {
    const rx = await receiver()
    const h = await harness({ url: rx.url, secret: null })
    try {
      h.dispatcher.enqueue([event()])
      await h.dispatcher.tick()
      const [row] = h.store.listDeliveries('wh-1')
      assert.equal(row.status, 'failed')
      assert.equal(row.lastError, 'No signing secret on this device')
      assert.equal(rx.received.length, 0)
    } finally {
      await rx.close()
      await h.cleanup()
    }
  })

  test('a URL that fails the policy is failed without sending', async () => {
    const h = await harness({ url: 'http://example.com/hook' })
    try {
      h.dispatcher.enqueue([event()])
      await h.dispatcher.tick()
      const [row] = h.store.listDeliveries('wh-1')
      assert.equal(row.status, 'failed')
      assert.match(row.lastError ?? '', /https/)
    } finally {
      await h.cleanup()
    }
  })

  test('redeliver and testSend add new pending rows and keep the log', async () => {
    const h = await harness({ url: 'https://example.com/hook' })
    try {
      h.dispatcher.enqueue([event()])
      const [original] = h.store.listDeliveries('wh-1')
      const copy = h.dispatcher.redeliver(original.id)
      assert.ok(copy && copy !== original.id)
      assert.equal(h.store.getDelivery(copy)?.payload, original.payload)
      assert.equal(h.store.getDelivery(copy)?.status, 'pending')
      assert.equal(h.store.getDelivery(original.id)?.status, 'pending')

      const test = h.dispatcher.testSend('wh-1')
      assert.ok(test)
      const payload = JSON.parse(h.store.getDelivery(test)!.payload)
      assert.equal(payload.test, true)
      assert.equal(payload.event, 'issue.updated')
      assert.equal(h.dispatcher.testSend('missing'), null)
    } finally {
      await h.cleanup()
    }
  })

  test('the log keeps the newest 500 deliveries per webhook', async () => {
    const h = await harness({ url: 'https://example.com/hook' })
    try {
      // Finished rows are pruned to the newest 500; pending rows are never dropped.
      for (let i = 0; i < 502; i++) {
        h.dispatcher.enqueue([event()])
        const [latest] = h.store.listDeliveries('wh-1', 1)
        h.store.updateDelivery({ ...latest, status: 'delivered' })
      }
      assert.equal(h.store.listDeliveries('wh-1', 1000).length, 500)
      h.dispatcher.enqueue([event()])
      h.dispatcher.enqueue([event()])
      const rows = h.store.listDeliveries('wh-1', 1000)
      assert.equal(rows.filter(r => r.status === 'pending').length, 2)
    } finally {
      await h.cleanup()
    }
  })
})

describe('WebhookSecrets', () => {
  test('round trips a secret without keys, stored as plaintext with 0600 mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'secrets-'))
    try {
      const s = new WebhookSecrets(dir)
      const created = await s.createSecret('wh-1')
      assert.match(created, /^whsec_[0-9a-f]{64}$/)
      assert.equal(await s.getSecret('wh-1'), created)
      assert.ok(readFileSync(join(dir, 'webhook-secrets.json'), 'utf8').includes(created))
      await s.deleteSecret('wh-1')
      assert.equal(await s.getSecret('wh-1'), null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('with keys, the file never holds the plaintext and rotate replaces the secret', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'secrets-'))
    const keys: SecretKeys = {
      seal: async text => `sealed:${Buffer.from(text).toString('base64')}`,
      open: async sealed => (sealed.startsWith('sealed:') ? Buffer.from(sealed.slice(7), 'base64').toString() : null)
    }
    try {
      const s = new WebhookSecrets(dir, keys)
      const first = await s.createSecret('wh-1')
      assert.equal(await s.getSecret('wh-1'), first)
      assert.equal(readFileSync(join(dir, 'webhook-secrets.json'), 'utf8').includes(first), false)

      const second = await s.rotateSecret('wh-1')
      assert.notEqual(second, first)
      assert.equal(await s.getSecret('wh-1'), second)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a value that cannot be opened reads as missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'secrets-'))
    try {
      const s = new WebhookSecrets(dir, {
        seal: async t => t,
        open: async () => {
          throw new Error('decrypt failed')
        }
      })
      await s.createSecret('wh-1')
      assert.equal(await s.getSecret('wh-1'), null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
