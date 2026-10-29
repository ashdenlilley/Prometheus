import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CloudSync, normalizeServerUrl, SIGNED_OUT, type SocketLike } from '../../src/main/cloud'
import { Clock, type Op } from '../../src/shared/sync'
import { emptyData } from '../../src/shared/seed'
import type { AppData } from '../../src/shared/types'

// Test-only placeholder origin. Nothing is sent over the network: fetch and WebSocket are fakes.
const SERVER = 'https://sync.example.test'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const hlc = (ms: number, cnt = 1) => `${String(ms).padStart(15, '0')}.${String(cnt).padStart(6, '0')}.laptop`
const issueOp = (ms: number, id: string, title: string): Op => ({ hlc: hlc(ms), table: 'issues', id, create: true, set: { title } })
const tokens = () => ({ refreshToken: 'refresh-1', accessToken: 'access-1', accessExpiresAt: Date.now() + 900_000, deviceId: 'dev-1' })

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = []
  sent: any[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  constructor(
    readonly url: string,
    readonly protocols: string[]
  ) {
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {}
  open() {
    this.onopen?.()
  }
  frame(f: unknown) {
    this.onmessage?.({ data: JSON.stringify(f) })
  }
  // A close from the server's side, e.g. 4001 for a revoked device or 1006 for a dropped network.
  drop(code: number) {
    this.onclose?.({ code })
  }
  pushes(): any[] {
    return this.sent.filter(f => f.type === 'push')
  }
}

async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise(r => setTimeout(r, 2))
  }
}

// Config and outbox are written asynchronously, so a file may not exist yet.
const fileText = (dir: string, name: string) => {
  try {
    return readFileSync(join(dir, name), 'utf8')
  } catch {
    return ''
  }
}

async function socketAt(i: number): Promise<FakeSocket> {
  await until(() => FakeSocket.all.length > i)
  return FakeSocket.all[i]
}

type Handler = (body: any) => Response
// Every client made by a test is stopped at the end, so a failed assertion cannot leave a timer running.
const clouds: CloudSync[] = []
const track = (c: CloudSync) => {
  clouds.push(c)
  return c
}

function harness(handlers: Record<string, Handler>, initialData: AppData = emptyData()) {
  FakeSocket.all = []
  const dir = mkdtempSync(join(tmpdir(), 'cloud-'))
  const creds = new Map<string, string>()
  const credentials = {
    async get(name: string) {
      return creds.get(name) ?? null
    },
    async set(name: string, value: string) {
      creds.set(name, value)
    },
    async delete(name: string) {
      creds.delete(name)
    }
  }
  const calls: string[] = []
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    const key = `${init?.method ?? 'GET'} ${path}`
    calls.push(key)
    const h = handlers[key] ?? handlers[path]
    return h ? h(init?.body ? JSON.parse(String(init.body)) : undefined) : json({ error: 'not_found' }, 404)
  }
  const clocks = new Map<string, string>()
  const store = {
    async setClocks() {},
    async clearClocks() {}
  }
  const state = { data: initialData, writes: [] as AppData[] }
  const make = () =>
    track(
      new CloudSync({
        dir,
        store,
        clock: new Clock('laptop'),
        clocks,
        credentials,
        fetch: fetch as unknown as typeof globalThis.fetch,
        WebSocket: FakeSocket,
        pollMs: 1,
        pingMs: 1e9,
        minRetryMs: 1,
        maxRetryMs: 5,
        hooks: {
          read: () => state.data,
          write: next => {
            state.data = next
            state.writes.push(next)
          }
        }
      })
    )
  return { dir, creds, calls, state, make, cloud: make() }
}

// Start, then poll once more than needed to get tokens. The first poll is pending.
function signInHandlers(extra: Record<string, Handler> = {}): Record<string, Handler> {
  let polls = 0
  return {
    '/auth/start': () => json({ requestId: 'req-1', pollSecret: 'secret-1', expiresAt: Date.now() + 900_000 }),
    '/auth/poll': () => (++polls === 1 ? json({ status: 'pending' }, 202) : json(tokens())),
    ...extra
  }
}

// Signs in and connects; the server reports `head` at ready. An empty head merges automatically.
async function signedIn(h: ReturnType<typeof harness>, head = 0) {
  await h.cloud.startSignIn(SERVER, 'owner@example.test', 'Laptop')
  const s = await socketAt(0)
  s.open()
  s.frame({ type: 'ready', head })
  return s
}

describe('CloudSync', () => {
  after(() => clouds.forEach(c => c.stop()))

  test('server URL must be https, except a loopback server', () => {
    assert.equal(normalizeServerUrl('https://sync.example.test/some/path'), 'https://sync.example.test')
    assert.equal(normalizeServerUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787')
    assert.equal(normalizeServerUrl('http://localhost:8787'), 'http://localhost:8787')
    assert.throws(() => normalizeServerUrl('http://sync.example.test'), /https/)
    assert.throws(() => normalizeServerUrl('ftp://127.0.0.1'), /https/)
    assert.throws(() => normalizeServerUrl('not a url'), /valid server URL/)
  })

  test('sign-in polls until tokens; the refresh token is only in credentials', async () => {
    const h = harness(signInHandlers())
    await h.cloud.startSignIn(SERVER, 'owner@example.test', 'Laptop')
    assert.equal(h.cloud.getStatus().state, 'signing-in')
    assert.equal(h.cloud.getStatus().signIn?.email, 'owner@example.test')
    await until(() => h.cloud.getStatus().enabled)
    await until(() => fileText(h.dir, 'cloud-sync.json').includes('"enabled": true'))
    assert.equal(h.creds.get('cloud.refreshToken'), 'refresh-1')
    const files = fileText(h.dir, 'cloud-sync.json') + fileText(h.dir, 'cloud-outbox.json')
    assert.ok(!files.includes('refresh-1') && !files.includes('access-1'), 'no token in the config or outbox file')
    assert.equal(h.cloud.getStatus().deviceId, 'dev-1')
    assert.equal(h.cloud.getStatus().signIn, null)
    h.cloud.stop()
  })

  test('sign-in reports an expired link (410) and an unknown request (404)', async () => {
    const gone = harness({ '/auth/start': () => json({ requestId: 'r', pollSecret: 's', expiresAt: Date.now() + 9e5 }), '/auth/poll': () => json({ error: 'gone' }, 410) })
    await gone.cloud.startSignIn(SERVER, 'owner@example.test', 'Laptop')
    await until(() => gone.cloud.getStatus().error !== null)
    assert.match(gone.cloud.getStatus().error!, /expired/)
    assert.equal(gone.cloud.getStatus().state, 'off')
    gone.cloud.stop()

    const missing = harness({ '/auth/start': () => json({ requestId: 'r', pollSecret: 's', expiresAt: Date.now() + 9e5 }), '/auth/poll': () => json({ error: 'not_found' }, 404) })
    await missing.cloud.startSignIn(SERVER, 'owner@example.test', 'Laptop')
    await until(() => missing.cloud.getStatus().error !== null)
    assert.match(missing.cloud.getStatus().error!, /not found/)
    missing.cloud.stop()
  })

  test('the outbox survives a restart and its ops are sent after reconnect', async () => {
    const h = harness(signInHandlers())
    await signedIn(h, 0)
    h.cloud.record([issueOp(1000, 'i1', 'queued')])
    await until(() => fileText(h.dir, 'cloud-outbox.json').includes('queued'))
    h.cloud.stop()

    const again = h.make()
    await again.init()
    assert.equal(again.getStatus().pending, 1)
    again.stop()
  })

  test('a retry after reconnect reuses the push id and the same ops', async () => {
    const h = harness(signInHandlers())
    await signedIn(h, 0) // empty server: merges automatically, then reconnects
    const joined = await socketAt(1)
    joined.open()
    joined.frame({ type: 'ready', head: 0 })
    assert.equal(h.cloud.getStatus().needsJoin, false)

    h.cloud.record([issueOp(1000, 'i1', 'first')])
    const first = joined.pushes()[0]
    joined.drop(1006) // lost before the ack

    const retry = await socketAt(2)
    retry.open()
    retry.frame({ type: 'ready', head: 0 })
    const second = retry.pushes()[0]
    assert.equal(second.id, first.id)
    assert.deepEqual(second.ops, first.ops)

    retry.frame({ type: 'ack', id: second.id, seqs: [1], head: 1 })
    assert.equal(h.cloud.getStatus().pending, 0, 'ack removes the batch')
    h.cloud.stop()
  })

  test('a skew error becomes a status error that mentions the clock, and keeps the batch', async () => {
    const h = harness(signInHandlers())
    const s = await signedIn(h, 0)
    const joined = await socketAt(1)
    joined.open()
    joined.frame({ type: 'ready', head: 0 })
    h.cloud.record([issueOp(Date.now() + 9 * 60_000, 'i1', 'future')])
    const push = joined.pushes()[0]
    joined.frame({ type: 'error', id: push.id, code: 'skew', skewMs: 9 * 60_000 })
    assert.match(h.cloud.getStatus().error ?? '', /clock/)
    assert.equal(h.cloud.getStatus().pending, 1)
    assert.ok(s)
    h.cloud.stop()
  })

  test('an invalid batch is dropped with an error, so it does not loop', async () => {
    const h = harness(signInHandlers())
    await signedIn(h, 0)
    const joined = await socketAt(1)
    joined.open()
    joined.frame({ type: 'ready', head: 0 })
    h.cloud.record([issueOp(1000, 'i1', 'bad')])
    const push = joined.pushes()[0]
    joined.frame({ type: 'error', id: push.id, code: 'invalid', index: 0, message: 'unknown table' })
    assert.equal(h.cloud.getStatus().pending, 0)
    assert.match(h.cloud.getStatus().error ?? '', /rejected/)
    h.cloud.stop()
  })

  test('close code 4001 signs the device out, deletes its refresh token and keeps local data', async () => {
    const h = harness(signInHandlers())
    const data = { ...emptyData(), me: 'Keep me' }
    h.state.data = data
    await signedIn(h, 0)
    const joined = await socketAt(1)
    joined.open()
    joined.frame({ type: 'ready', head: 0 })
    joined.drop(4001)
    await until(() => !h.cloud.getStatus().enabled)
    assert.equal(h.cloud.getStatus().error, SIGNED_OUT)
    assert.equal(h.cloud.getStatus().state, 'off')
    assert.equal(h.creds.has('cloud.refreshToken'), false)
    assert.equal(h.state.data.me, 'Keep me')
    h.cloud.stop()
  })

  test('merge sends this device data as a snapshot; adopt replaces it with the server copy', async () => {
    const local = { ...emptyData(), issues: [{ id: 'local', title: 'local', projectId: '', number: 1, createdAt: new Date().toISOString() }] as any }

    // Merge: the server already has data (head 3), so the user chooses.
    const merge = harness(signInHandlers(), local)
    await signedIn(merge, 3)
    assert.equal(merge.cloud.getStatus().needsJoin, true)
    await merge.cloud.join('merge')
    const mergeSock = await socketAt(1)
    mergeSock.open()
    mergeSock.frame({ type: 'ready', head: 3 })
    const pushed = mergeSock.pushes()
    assert.ok(pushed.length > 0 && pushed.flatMap(p => p.ops).some((o: Op) => o.table === 'issues' && o.id === 'local'))
    merge.cloud.stop()

    // Adopt: the local issue goes; the server's op replaces it, and lastSeq is saved.
    const adopt = harness(signInHandlers(), local)
    await signedIn(adopt, 1)
    await adopt.cloud.join('adopt')
    const adoptSock = await socketAt(1)
    adoptSock.open()
    adoptSock.frame({ type: 'ready', head: 1 })
    adoptSock.frame({ type: 'ops', ops: [{ seq: 1, op: issueOp(2000, 'remote', 'from server') }], head: 1 })
    assert.deepEqual(
      adopt.state.data.issues.map(i => i.title),
      ['from server']
    )
    assert.equal(adopt.cloud.getStatus().pending, 0)
    await until(() => /"lastSeq": 1/.test(fileText(adopt.dir, 'cloud-sync.json')))
    adopt.cloud.stop()
  })

  test('a device that is not joined cannot join twice', async () => {
    const h = harness(signInHandlers())
    await signedIn(h, 0)
    await until(() => h.cloud.getStatus().enabled && h.cloud.getStatus().needsJoin === false)
    await assert.rejects(h.cloud.join('merge'), /Nothing to join/)
    h.cloud.stop()
  })
})
