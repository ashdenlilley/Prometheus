import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SlackSender, allowedWebhookUrl, webhookCredential, webhookHint } from '../../src/main/slack'
import { slackMessage } from '../../src/shared/integrations'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'

type Responder = (req: IncomingMessage, res: ServerResponse) => void
const ok: Responder = (_req, res) => res.end('ok')
const status = (code: number, body = '', headers: Record<string, string> = {}): Responder => (_req, res) => {
  res.writeHead(code, headers)
  res.end(body)
}

// A real HTTP receiver on 127.0.0.1. Each request gets the next scripted responder (200 ok once the script runs out).
async function receiver(script: Responder[]) {
  const seen: { method?: string; contentType?: string; body: string }[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      seen.push({ method: req.method, contentType: req.headers['content-type'], body })
      ;(script.shift() ?? ok)(req, res)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  return { base, url: `${base}services/T000/B000/abcd`, seen, close: () => new Promise(resolve => server.close(resolve)) }
}

const message = { text: 'hello', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hello' } }] }

// Sleeps are recorded instead of waited for.
const clock = () => {
  const sleeps: number[] = []
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) }
}

let server: Awaited<ReturnType<typeof receiver>> | null = null
afterEach(async () => {
  await server?.close()
  server = null
  delete process.env.PROMETHEUS_SLACK_TEST_URL_BASE
})

describe('SlackSender', () => {
  test('a 200 ok posts JSON and reports success', async () => {
    server = await receiver([])
    const sender = new SlackSender({ allow: url => url.startsWith(server!.base), ...clock() })
    assert.deepEqual(await sender.send(server.url, message), { ok: true })
    assert.equal(server.seen.length, 1)
    assert.equal(server.seen[0].method, 'POST')
    assert.equal(server.seen[0].contentType, 'application/json')
    assert.deepEqual(JSON.parse(server.seen[0].body), message)
  })

  test('429 waits for Retry-After and then succeeds', async () => {
    server = await receiver([status(429, 'rate_limited', { 'Retry-After': '1' })])
    const timing = clock()
    const sender = new SlackSender({ allow: url => url.startsWith(server!.base), ...timing })
    assert.deepEqual(await sender.send(server.url, message), { ok: true })
    assert.deepEqual(timing.sleeps, [1000])
    assert.equal(server.seen.length, 2)
  })

  test('429 without Retry-After waits one second, and Retry-After is capped at 60s', async () => {
    server = await receiver([status(429), status(429, '', { 'Retry-After': '600' })])
    const timing = clock()
    const sender = new SlackSender({ allow: url => url.startsWith(server!.base), ...timing })
    assert.deepEqual(await sender.send(server.url, message), { ok: true })
    assert.deepEqual(timing.sleeps, [1000, 60_000])
  })

  test('500 backs off exponentially and then succeeds', async () => {
    server = await receiver([status(500, 'internal'), status(503, 'busy')])
    const timing = clock()
    const sender = new SlackSender({ allow: url => url.startsWith(server!.base), ...timing })
    assert.deepEqual(await sender.send(server.url, message), { ok: true })
    assert.deepEqual(timing.sleeps, [1000, 2000])
  })

  test('gives up after maxAttempts on persistent 5xx', async () => {
    server = await receiver([status(500), status(500), status(500)])
    const timing = clock()
    const sender = new SlackSender({ allow: url => url.startsWith(server!.base), maxAttempts: 3, ...timing })
    const res = await sender.send(server.url, message)
    assert.deepEqual(res, { ok: false, status: 500, error: 'Slack returned 500' })
    assert.equal(server.seen.length, 3)
  })

  test('a 404 no_service is not retried and returns the Slack error text', async () => {
    server = await receiver([status(404, 'no_service')])
    const timing = clock()
    const sender = new SlackSender({ allow: url => url.startsWith(server!.base), ...timing })
    assert.deepEqual(await sender.send(server.url, message), { ok: false, status: 404, error: 'no_service' })
    assert.equal(server.seen.length, 1)
    assert.deepEqual(timing.sleeps, [])
  })

  test('a 400 invalid_payload is returned truncated to 200 characters, without the URL', async () => {
    server = await receiver([status(400, 'x'.repeat(500))])
    const sender = new SlackSender({ allow: url => url.startsWith(server!.base), ...clock() })
    const res = await sender.send(server.url, message)
    assert.equal(res.ok, false)
    assert.equal((res as { error: string }).error.length, 200)
    assert.equal((res as { error: string }).error.includes(server.url), false)
  })

  test('network failures retry with backoff and then report without the URL', async () => {
    // A fake fetch that always fails, so nothing leaves the machine
    let attempts = 0
    const fetchImpl = (async () => {
      attempts++
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const timing = clock()
    const sender = new SlackSender({ fetchImpl, allow: () => true, maxAttempts: 4, ...timing })
    const res = await sender.send('https://hooks.slack.com/services/T000/B000/abcd', message)
    assert.deepEqual(res, { ok: false, error: 'Network error' })
    assert.equal(attempts, 4)
    assert.deepEqual(timing.sleeps, [1000, 2000, 4000])
  })

  test('a URL the policy rejects is never requested', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      return new Response('ok')
    }) as typeof fetch
    const sender = new SlackSender({ fetchImpl, allow: allowedWebhookUrl, ...clock() })
    const rejected = [
      'http://hooks.slack.com/services/T/B/x',
      'https://hooks.slack.com.evil.com/services/T/B/x',
      'https://evil.com/services/T/B/x',
      'https://user:pw@hooks.slack.com/services/T/B/x',
      'https://hooks.slack.com:8443/services/T/B/x',
      'https://hooks.slack.com/api/chat.postMessage',
      'http://127.0.0.1:9/services/T/B/x'
    ]
    for (const url of rejected) {
      const res = await sender.send(url, message)
      assert.equal(res.ok, false)
    }
    assert.deepEqual(calls, [])
  })

  test('the test-only base lets the local receiver through, and only on 127.0.0.1', async () => {
    server = await receiver([])
    process.env.PROMETHEUS_SLACK_TEST_URL_BASE = server.base
    assert.equal(allowedWebhookUrl(server.url), true)
    assert.equal(allowedWebhookUrl('http://127.0.0.1:1/other'), false)
    process.env.PROMETHEUS_SLACK_TEST_URL_BASE = 'http://evil.example/'
    assert.equal(allowedWebhookUrl('http://evil.example/x'), false)
  })

  test('queued jobs run one at a time in order, and failures report the name without the URL', async () => {
    server = await receiver([status(404, 'channel_not_found')])
    const failures: { name: string; error: string }[] = []
    const sender = new SlackSender({
      allow: url => url.startsWith(server!.base),
      onFailure: f => failures.push(f),
      ...clock()
    })
    sender.enqueue({ name: 'Eng', url: server.url, message: { ...message, text: 'first' } })
    sender.enqueue({ name: 'Eng', url: server.url, message: { ...message, text: 'second' } })
    await sender.idle()
    assert.deepEqual(server.seen.map(s => JSON.parse(s.body).text), ['first', 'second'])
    assert.equal(failures.length, 1)
    assert.equal(failures[0].name, 'Eng')
    assert.equal(failures[0].error, 'channel_not_found')
    assert.equal(JSON.stringify(failures).includes(server.url), false)
  })

  test('a malicious title arrives escaped in the Block Kit payload', async () => {
    server = await receiver([])
    const base = blankProject({ id: 'p1', spaceId: 's1', name: 'Core', key: 'CORE', color: '#000000' })
    const data = { ...emptyData(), projects: [base], issues: [createIssue(emptyData(), 'p1', '<!channel> hi <@U1>', { id: 'i1', number: 3 })] }
    const sender = new SlackSender({ allow: url => url.startsWith(server!.base), ...clock() })
    assert.deepEqual(await sender.send(server.url, slackMessage(data, data.issues[0])), { ok: true })
    const body = server.seen[0].body
    assert.equal(body.includes('<!channel>'), false)
    assert.equal(body.includes('<@U1>'), false)
    const sent = JSON.parse(body)
    assert.equal(sent.blocks[0].text.text, '*CORE-3* &lt;!channel&gt; hi &lt;@U1&gt;')
  })
})

describe('webhook helpers', () => {
  test('the credential name is per integration', () => {
    assert.equal(webhookCredential('int1'), 'slack.webhook.int1')
  })

  test('the hint shows the host and the last four characters only', () => {
    const hint = webhookHint('https://hooks.slack.com/services/T000/B000/secretabcd')
    assert.equal(hint, 'hooks.slack.com/…abcd')
    assert.equal(hint.includes('secret'), false)
  })
})
