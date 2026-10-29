import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { BASE, JWT_SECRET, OWNER, b64url, call, lastToken, signIn, waitFor, withWorker } from './helpers.mjs'

const startBody = (email, deviceName = 'Laptop') => ({ method: 'POST', body: { email, deviceName } })
const pollBody = s => ({ method: 'POST', body: { requestId: s.requestId, pollSecret: s.pollSecret } })

test('health and unknown paths', () =>
  withWorker({}, async w => {
    const h = await call(w, '/health')
    assert.equal(h.status, 200)
    assert.deepEqual(await h.json(), { ok: true })
    assert.equal((await call(w, '/nope')).status, 404)
  }))

test('missing config returns 500 naming the variable, never its value', () =>
  withWorker({ omit: ['JWT_SECRET'] }, async w => {
    const res = await call(w, '/auth/start', startBody(OWNER))
    assert.equal(res.status, 500)
    const body = await res.json()
    assert.match(body.message, /JWT_SECRET/)
    assert.equal(JSON.stringify(body).includes('test-email-key'), false)
  }))

test('a deploy that still has placeholder values refuses to run', async () => {
  for (const bindings of [{ JWT_SECRET: 'replace-with-64-random-hex-chars' }, { JWT_SECRET: 'short' }, { OWNER_EMAIL: 'you@example.com' }, { PUBLIC_URL: 'https://prometheus-sync.REPLACE_WITH_SUBDOMAIN.workers.dev' }]) {
    await withWorker({ bindings }, async w => {
      const res = await call(w, '/auth/start', startBody(OWNER))
      assert.equal(res.status, 500)
      assert.match((await res.json()).message, /placeholder|at least 32/)
      assert.equal(w.emails.length, 0)
    })
  }
})

test('start emails the owner once through the email API; others get the same shape and no email', () =>
  withWorker({}, async w => {
    const owner = await (await call(w, '/auth/start', startBody(' Owner@Prometheus.TEST '))).json()
    await waitFor(() => w.emails.length === 1)
    const mail = w.emails[0]
    assert.equal(mail.url, 'https://api.resend.com/emails')
    assert.equal(mail.authorization, 'Bearer test-email-key')
    assert.deepEqual(mail.body.to, [OWNER])
    assert.match(mail.body.text, new RegExp(`${BASE}/auth/verify\\?t=[A-Za-z0-9_-]{43}`))

    const other = await call(w, '/auth/start', startBody('someone@example.com'))
    assert.equal(other.status, 200)
    const stranger = await other.json()
    assert.deepEqual(Object.keys(stranger).sort(), Object.keys(owner).sort())
    await new Promise(r => setTimeout(r, 200))
    assert.equal(w.emails.length, 1)
  }))

test('GET verify only shows a confirm page; POST verifies; poll gives tokens once, then 410', () =>
  withWorker({}, async w => {
    const s = await (await call(w, '/auth/start', startBody(OWNER))).json()
    await waitFor(() => w.emails.length === 1)
    const t = lastToken(w)

    const page = await call(w, `/auth/verify?t=${t}`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /Confirm sign-in/)
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/)
    assert.equal((await call(w, '/auth/poll', pollBody(s))).status, 202)

    const done = await call(w, '/auth/verify', { method: 'POST', form: { t } })
    assert.equal(done.status, 200)
    assert.match(await done.text(), /Signed in\. You can close this tab and return to Prometheus\./)

    const first = await call(w, '/auth/poll', pollBody(s))
    assert.equal(first.status, 200)
    const tokens = await first.json()
    assert.ok(tokens.refreshToken && tokens.accessToken && tokens.deviceId && tokens.accessExpiresAt > Date.now())
    assert.equal((await call(w, '/auth/poll', pollBody(s))).status, 410)
  }))

test('a wrong poll secret is 404 and does not reveal state', () =>
  withWorker({}, async w => {
    const s = await (await call(w, '/auth/start', startBody(OWNER))).json()
    await waitFor(() => w.emails.length === 1)
    await call(w, '/auth/verify', { method: 'POST', form: { t: lastToken(w) } })
    const bad = await call(w, '/auth/poll', { method: 'POST', body: { requestId: s.requestId, pollSecret: 'wrong' } })
    assert.equal(bad.status, 404)
  }))

test('a used link is rejected, and an unknown token is rejected', () =>
  withWorker({}, async w => {
    await call(w, '/auth/start', startBody(OWNER))
    await waitFor(() => w.emails.length === 1)
    const t = lastToken(w)
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t } })).status, 200)
    const again = await call(w, '/auth/verify', { method: 'POST', form: { t } })
    assert.equal(again.status, 400)
    assert.match(await again.text(), /invalid or has expired/)
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t: 'not-a-token' } })).status, 400)
  }))

test('an expired link is rejected and its request is gone', () =>
  withWorker({ bindings: { LINK_TTL_SECONDS: '1' } }, async w => {
    const s = await (await call(w, '/auth/start', startBody(OWNER))).json()
    await waitFor(() => w.emails.length === 1)
    await new Promise(r => setTimeout(r, 1100))
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t: lastToken(w) } })).status, 400)
    assert.equal((await call(w, '/auth/poll', pollBody(s))).status, 410)
  }))

test('rate limits: 5 starts per email and 20 per IP in 15 minutes, then 429 with Retry-After', () =>
  withWorker({}, async w => {
    for (let i = 0; i < 5; i++) assert.equal((await call(w, '/auth/start', { ...startBody('a@example.com'), ip: '203.0.113.1' })).status, 200)
    const limited = await call(w, '/auth/start', { ...startBody('a@example.com'), ip: '203.0.113.1' })
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) > 0)

    for (let i = 0; i < 20; i++) assert.equal((await call(w, '/auth/start', { ...startBody(`u${i}@example.com`), ip: '203.0.113.2' })).status, 200)
    assert.equal((await call(w, '/auth/start', { ...startBody('u99@example.com'), ip: '203.0.113.2' })).status, 429)
  }))

test('access tokens: alg none, tampered and expired tokens are rejected', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    const ok = await call(w, '/devices', { headers: { authorization: `Bearer ${s.accessToken}` } })
    assert.equal(ok.status, 200)

    const [h, p, sig] = s.accessToken.split('.')
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
    const bearer = t => ({ headers: { authorization: `Bearer ${t}` } })

    const none = `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${p}.`
    assert.equal((await call(w, '/devices', bearer(none))).status, 401)

    const tampered = `${h}.${b64url(JSON.stringify({ ...claims, dev: 'someone-else' }))}.${sig}`
    assert.equal((await call(w, '/devices', bearer(tampered))).status, 401)

    const past = Math.floor(Date.now() / 1000) - 60
    const body = b64url(JSON.stringify({ sub: 'owner', dev: claims.dev, iat: past - 900, exp: past }))
    const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const expired = `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`
    assert.equal((await call(w, '/devices', bearer(expired))).status, 401)
    assert.equal((await call(w, '/devices', bearer('garbage'))).status, 401)
  }))

test('refresh rotates tokens; reusing a retired refresh token revokes the device', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    const r1 = await (await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } })).json()
    assert.notEqual(r1.refreshToken, s.refreshToken)
    assert.equal((await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } })).status, 401)
    assert.equal((await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: r1.refreshToken } })).status, 401)
    assert.equal((await call(w, '/devices', { headers: { authorization: `Bearer ${r1.accessToken}` } })).status, 401)
  }))

test('each rotation hands out a refresh token that works', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    const r1 = await (await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } })).json()
    const r2 = await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: r1.refreshToken } })
    assert.equal(r2.status, 200)
  }))

test('devices: list marks the current one; revoke one device blocks it; unknown id is 404', () =>
  withWorker({}, async w => {
    const a = await signIn(w, 'Laptop')
    const b = await signIn(w, 'Phone')
    const list = await (await call(w, '/devices', { headers: { authorization: `Bearer ${a.accessToken}` } })).json()
    assert.equal(list.length, 2)
    assert.equal(list.find(d => d.id === a.deviceId).current, true)
    assert.equal(list.find(d => d.id === b.deviceId).current, false)
    assert.deepEqual(Object.keys(list[0]).sort(), ['createdAt', 'current', 'id', 'lastSeenAt', 'name'])

    const auth = { authorization: `Bearer ${a.accessToken}` }
    assert.equal((await call(w, `/devices/${b.deviceId}`, { method: 'DELETE', headers: auth })).status, 200)
    assert.equal((await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: b.refreshToken } })).status, 401)
    assert.equal((await call(w, '/devices', { headers: { authorization: `Bearer ${b.accessToken}` } })).status, 401)
    assert.equal((await call(w, '/devices/no-such-device', { method: 'DELETE', headers: auth })).status, 404)
    const after = await (await call(w, '/devices', { headers: auth })).json()
    assert.deepEqual(after.map(d => d.id), [a.deviceId])
  }))

test('signout-all revokes every device', () =>
  withWorker({}, async w => {
    const a = await signIn(w, 'Laptop')
    const b = await signIn(w, 'Phone')
    const res = await call(w, '/auth/signout-all', { method: 'POST', headers: { authorization: `Bearer ${a.accessToken}` } })
    assert.equal(res.status, 200)
    assert.equal((await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: a.refreshToken } })).status, 401)
    assert.equal((await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: b.refreshToken } })).status, 401)
    assert.equal((await call(w, '/auth/signout-all', { method: 'POST' })).status, 401)
  }))
