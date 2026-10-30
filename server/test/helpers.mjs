// Shared harness: a fresh Miniflare per test, with the email API stubbed at the outbound fetch.
import { Miniflare } from 'miniflare'

export const OWNER = 'owner@prometheus.test' // test-only owner
export const JWT_SECRET = 'test-jwt-secret-not-a-real-key-0123456789abcdef'
export const BASE = 'https://sync.test'
const SCRIPT = new URL('../dist/worker.js', import.meta.url).pathname

export async function createWorker({ bindings = {}, omit = [], ratelimits } = {}) {
  const emails = []
  const all = {
    OWNER_EMAIL: OWNER,
    JWT_SECRET,
    PUBLIC_URL: BASE,
    EMAIL_API_KEY: 'test-email-key',
    EMAIL_FROM: 'Prometheus <signin@example.com>',
    EMAIL_PROVIDER: 'resend',
    COMPACT_AT: '10000',
    COMPACT_KEEP: '2000',
    ...bindings
  }
  for (const k of omit) delete all[k]
  const mf = new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: '2026-08-01',
    durableObjects: {
      AUTH: { className: 'Auth', useSQLite: true },
      WORKSPACE: { className: 'Workspace', useSQLite: true }
    },
    bindings: all,
    ...(ratelimits && { ratelimits }),
    unsafeInspectDurableObjects: true,
    // Records every outbound call (the email API) instead of sending it.
    outboundService: async req => {
      emails.push({ url: req.url, authorization: req.headers.get('authorization'), body: await req.json() })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  return { mf, emails, dispose: () => mf.dispose() }
}

export async function withWorker(opts, fn) {
  const w = await createWorker(opts)
  try {
    await fn(w)
  } finally {
    await w.dispose()
  }
}

// raw: a body sent as is, with the content-type taken from headers (for refusals such as text/plain).
export function call(w, path, { method = 'GET', body, form, raw, headers = {}, ip } = {}) {
  const h = { ...headers }
  let payload
  if (raw !== undefined) {
    payload = raw
  } else if (form) {
    h['content-type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(form).toString()
  } else if (body !== undefined) {
    h['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (ip) h['cf-connecting-ip'] = ip
  // dispatchFetch sends string bodies chunked; real clients send Content-Length, which the server requires.
  if (typeof payload === 'string' && !Object.keys(h).some(k => k.toLowerCase() === 'content-length')) h['content-length'] = String(Buffer.byteLength(payload))
  return w.mf.dispatchFetch(BASE + path, { method, headers: h, body: payload })
}

// Test-only SQL on the Auth object's storage. Seeds rate-limit rows and members without waiting in real time.
export async function authSql(w, text, ...params) {
  const storage = await w.mf.unsafeGetDurableObjectStorage('', 'Auth', { name: 'auth' })
  return storage.exec(text, ...params)
}

export async function waitFor(pred, ms = 3000) {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise(r => setTimeout(r, 10))
  }
}

// The link token from the last email sent to the owner.
export function lastToken(w) {
  const link = /https?:\/\/\S+/.exec(w.emails.at(-1).body.text)[0]
  return new URL(link).searchParams.get('t')
}

// Full sign-in on one device: start, confirm the emailed link, poll for tokens. Defaults to the owner.
export async function signIn(w, deviceName = 'Laptop', email = OWNER) {
  const before = w.emails.length
  const start = await (await call(w, '/auth/start', { method: 'POST', body: { email, deviceName } })).json()
  await waitFor(() => w.emails.length > before)
  await call(w, '/auth/verify', { method: 'POST', form: { t: lastToken(w), code: start.code } })
  const res = await call(w, '/auth/poll', { method: 'POST', body: { requestId: start.requestId, pollSecret: start.pollSecret } })
  return res.json()
}

// Owner invites someone. Waits for the invite email and returns its token (null when the request was refused).
export async function invite(w, ownerAccess, body) {
  const before = w.emails.length
  const res = await call(w, '/invites', { method: 'POST', body, headers: { authorization: `Bearer ${ownerAccess}` } })
  if (res.status !== 201) return { res, token: null }
  await waitFor(() => w.emails.length > before)
  return { res, token: new URL(/https?:\/\/\S+/.exec(w.emails.at(-1).body.text)[0]).searchParams.get('t') }
}

export const accept = (w, token) => call(w, '/invite', { method: 'POST', form: { t: token } })

// Owner invites, the invitee accepts, then signs in as them. Returns the invitee's tokens.
export async function join(w, email, role, projects) {
  const owner = await signIn(w)
  const { token } = await invite(w, owner.accessToken, { email, role, projects })
  await accept(w, token)
  return signIn(w, 'Laptop', email)
}

// A single-use sync ticket for the device behind an access token.
export async function ticket(w, access) {
  return (await (await call(w, '/sync/ticket', { method: 'POST', headers: { authorization: `Bearer ${access}` } })).json()).ticket
}

// Opens a sync socket. By default the access token is traded for a ticket (ticket.<t>). { bearer: true } sends the
// deprecated bearer.<access>, and { protocol } sends that exact header. A null access sends no protocol. Returns { status } if refused.
export async function openSocket(w, access, query = '', { bearer = false, protocol } = {}) {
  let proto = protocol
  if (proto === undefined && access !== null) proto = bearer ? `prometheus-sync, bearer.${access}` : `prometheus-sync, ticket.${await ticket(w, access)}`
  const headers = { Upgrade: 'websocket' }
  if (proto !== undefined) headers['Sec-WebSocket-Protocol'] = proto
  const res = await w.mf.dispatchFetch(BASE + '/sync' + query, { headers })
  if (res.status !== 101) return { status: res.status }
  const ws = res.webSocket
  ws.accept()
  const sock = { status: 101, ws, frames: [], closeCode: null }
  sock.send = m => ws.send(JSON.stringify(m))
  sock.ofType = t => sock.frames.filter(f => f.type === t)
  ws.addEventListener('message', e => sock.frames.push(JSON.parse(e.data)))
  ws.addEventListener('close', e => {
    sock.closeCode = e.code
  })
  return sock
}

// Sends hello and resolves with the ready frame once catch-up is complete. Frames stay in sock.frames.
export async function hello(sock, since = 0) {
  const before = sock.ofType('ready').length
  sock.send({ type: 'hello', since })
  await waitFor(() => sock.ofType('ready').length > before)
  return sock.ofType('ready').at(-1)
}

// Waits for the ack of push `id`.
export async function ackFor(sock, id) {
  await waitFor(() => sock.frames.some(f => f.type !== 'ops' && f.id === id))
  return sock.frames.find(f => f.type !== 'ops' && f.id === id)
}

export const hlc = (ms, cnt, dev) => `${String(ms).padStart(15, '0')}.${String(cnt).padStart(6, '0')}.${dev}`

export const b64url = s => Buffer.from(s).toString('base64url')
