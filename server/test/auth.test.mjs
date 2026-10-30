import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { BASE, JWT_SECRET, OWNER, authSql, b64url, call, invite, lastToken, signIn, waitFor, withWorker } from './helpers.mjs'

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
    assert.match(owner.code, /^\d{6}$/)
    assert.match(stranger.code, /^\d{6}$/)
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

    const done = await call(w, '/auth/verify', { method: 'POST', form: { t, code: s.code } })
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
    await call(w, '/auth/verify', { method: 'POST', form: { t: lastToken(w), code: s.code } })
    const bad = await call(w, '/auth/poll', { method: 'POST', body: { requestId: s.requestId, pollSecret: 'wrong' } })
    assert.equal(bad.status, 404)
  }))

test('a used link is rejected, and an unknown token is rejected', () =>
  withWorker({}, async w => {
    const s = await (await call(w, '/auth/start', startBody(OWNER))).json()
    await waitFor(() => w.emails.length === 1)
    const t = lastToken(w)
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t, code: s.code } })).status, 200)
    const again = await call(w, '/auth/verify', { method: 'POST', form: { t, code: s.code } })
    assert.equal(again.status, 400)
    assert.match(await again.text(), /invalid or has expired/)
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t: 'not-a-token' } })).status, 400)
  }))

test('an expired link is rejected and its request is gone', () =>
  withWorker({ bindings: { LINK_TTL_SECONDS: '1' } }, async w => {
    const s = await (await call(w, '/auth/start', startBody(OWNER))).json()
    await waitFor(() => w.emails.length === 1)
    await new Promise(r => setTimeout(r, 1100))
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t: lastToken(w), code: s.code } })).status, 400)
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

const sha256 = s => createHash('sha256').update(s).digest('hex')
const settle = () => new Promise(r => setTimeout(r, 200))

test('sign-in refuses a non-JSON body with 415 and sends no email', () =>
  withWorker({}, async w => {
    const res = await call(w, '/auth/start', { method: 'POST', raw: JSON.stringify({ email: OWNER }), headers: { 'content-type': 'text/plain' } })
    assert.equal(res.status, 415)
    assert.equal((await res.json()).error, 'unsupported_media_type')
    await settle()
    assert.equal(w.emails.length, 0)
  }))

test('a request with an Origin is refused with 403 and sends no email', () =>
  withWorker({}, async w => {
    const res = await call(w, '/auth/start', { ...startBody(OWNER), headers: { origin: 'https://evil.example' } })
    assert.equal(res.status, 403)
    assert.equal((await res.json()).error, 'bad_origin')
    await settle()
    assert.equal(w.emails.length, 0)
  }))

test('the sign-in form accepts its own origin or none, and refuses another origin', () =>
  withWorker({}, async w => {
    const s = await (await call(w, '/auth/start', startBody(OWNER))).json()
    await waitFor(() => w.emails.length === 1)
    const t = lastToken(w)
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t, code: s.code }, headers: { origin: 'https://evil.example' } })).status, 403)
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t, code: s.code }, headers: { origin: BASE } })).status, 200)
  }))

test('the invite form refuses another origin', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const { token } = await invite(w, owner.accessToken, { email: 'guest@example.com', role: 'viewer' })
    assert.equal((await call(w, '/invite', { method: 'POST', form: { t: token }, headers: { origin: 'https://evil.example' } })).status, 403)
    assert.equal((await call(w, '/invite', { method: 'POST', form: { t: token }, headers: { origin: BASE } })).status, 200)
  }))

test('per-address daily cap: the 21st start in 24 h gets 429, for a member and for a non-member', () =>
  withWorker({}, async w => {
    await call(w, '/auth/start', startBody('warm@example.com')) // creates the Auth object's tables
    const now = Date.now()
    for (const email of [OWNER, 'stranger@example.com']) {
      for (let i = 0; i < 20; i++) {
        await authSql(w, 'INSERT INTO starts (key, at, window_ms) VALUES (?, ?, ?)', `email-day:${sha256(email)}`, now - 3_600_000, 86_400_000)
      }
      const limited = await call(w, '/auth/start', { ...startBody(email), ip: '203.0.113.50' })
      assert.equal(limited.status, 429)
      assert.ok(Number(limited.headers.get('retry-after')) > 0)
    }
  }))

test('a day-long rate-limit row survives another request\'s cleanup', () =>
  withWorker({}, async w => {
    await call(w, '/auth/start', startBody('warm@example.com'))
    for (let i = 0; i < 20; i++) {
      await authSql(w, 'INSERT INTO starts (key, at, window_ms) VALUES (?, ?, ?)', `email-day:${sha256(OWNER)}`, Date.now() - 3_600_000, 86_400_000)
    }
    assert.equal((await call(w, '/auth/start', { ...startBody('other@example.com'), ip: '203.0.113.51' })).status, 200)
    assert.equal((await call(w, '/auth/start', { ...startBody(OWNER), ip: '203.0.113.51' })).status, 429)
  }))

test('global daily cap: a capped member gets the same reply as a non-member, and no email', () =>
  withWorker({ bindings: { EMAIL_CAP_DAY: '2' } }, async w => {
    await call(w, '/auth/start', startBody('warm@example.com')) // creates the tables; a non-member gets no email
    const members = ['a@example.com', 'b@example.com', 'c@example.com']
    for (const [i, email] of members.entries()) {
      await authSql(w, "INSERT INTO users (id, email, name, role, projects, created_at) VALUES (?, ?, ?, 'member', '[]', ?)", `m${i}`, email, email.split('@')[0], Date.now())
    }
    const replies = []
    for (const email of members) {
      const res = await call(w, '/auth/start', { ...startBody(email), ip: '203.0.113.60' })
      assert.equal(res.status, 200)
      replies.push(await res.json())
    }
    await waitFor(() => w.emails.length === 2)
    await settle()
    assert.equal(w.emails.length, 2)
    assert.deepEqual(w.emails.map(e => e.body.to[0]), members.slice(0, 2))
    const shape = Object.keys(replies[0]).sort()
    assert.deepEqual(shape, ['code', 'expiresAt', 'pollSecret', 'requestId'])
    for (const r of replies) assert.deepEqual(Object.keys(r).sort(), shape)
  }))

test('IPv6 is bucketed per /48: 21 addresses in different /64s of one /48 share the limit', () =>
  withWorker({}, async w => {
    for (let i = 1; i <= 20; i++) {
      assert.equal((await call(w, '/auth/start', { ...startBody(`v${i}@example.com`), ip: `2001:db8:0:${i.toString(16)}::1` })).status, 200)
    }
    assert.equal((await call(w, '/auth/start', { ...startBody('v21@example.com'), ip: '2001:db8:0:ffff::1' })).status, 429)
    assert.equal((await call(w, '/auth/start', { ...startBody('v22@example.com'), ip: '2001:db8:1::1' })).status, 200)
  }))

test('no code or a wrong code does not verify, the poll stays pending, and the right code verifies', () =>
  withWorker({}, async w => {
    const s = await (await call(w, '/auth/start', startBody(OWNER))).json()
    await waitFor(() => w.emails.length === 1)
    const t = lastToken(w)
    const wrong = s.code === '000000' ? '111111' : '000000'
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t } })).status, 400)
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t, code: wrong } })).status, 400)
    assert.equal((await call(w, '/auth/poll', pollBody(s))).status, 202)
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t, code: s.code } })).status, 200)
    assert.equal((await call(w, '/auth/poll', pollBody(s))).status, 200)
  }))

test('five wrong codes burn the request, so the right code no longer works', () =>
  withWorker({}, async w => {
    const s = await (await call(w, '/auth/start', startBody(OWNER))).json()
    await waitFor(() => w.emails.length === 1)
    const t = lastToken(w)
    const wrong = s.code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t, code: wrong } })).status, 400)
    assert.equal((await call(w, '/auth/verify', { method: 'POST', form: { t, code: s.code } })).status, 400)
    assert.equal((await call(w, '/auth/poll', pollBody(s))).status, 410)
  }))

test('the confirm page escapes the device name and asks for the 6-digit code', () =>
  withWorker({}, async w => {
    await call(w, '/auth/start', startBody(OWNER, '<b>x</b>'))
    await waitFor(() => w.emails.length === 1)
    const html = await (await call(w, `/auth/verify?t=${lastToken(w)}`)).text()
    assert.ok(html.includes('&#60;b&#62;x&#60;/b&#62;'))
    assert.equal(html.includes('<b>x</b>'), false)
    assert.match(html, /pattern="\[0-9\]\{6\}"/)
    assert.match(html, /didn't just try to sign in, close this page/)
  }))

// Signs an HS256 token with the given header and claims, the way a forger who knew the secret would.
const forge = (secret, header, claims) => {
  const head = b64url(JSON.stringify(header))
  const body = b64url(JSON.stringify(claims))
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`
}
const asBearer = t => ({ headers: { authorization: `Bearer ${t}` } })
const nowS = () => Math.floor(Date.now() / 1000)

test('access tokens carry iss, aud, sub and kid', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    const [h, p] = s.accessToken.split('.')
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'HS256', typ: 'JWT', kid: '1' })
    const c = JSON.parse(Buffer.from(p, 'base64url').toString())
    assert.equal(c.iss, new URL(BASE).origin)
    assert.equal(c.aud, 'prometheus-sync')
    assert.equal(c.sub, 'owner')
    assert.equal(c.dev, s.deviceId)
    assert.equal(c.exp - c.iat, 900)
  }))

test('a token with the wrong aud, iss, kid or sub is rejected', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    const claims = JSON.parse(Buffer.from(s.accessToken.split('.')[1], 'base64url').toString())
    const head = { alg: 'HS256', typ: 'JWT', kid: '1' }
    assert.equal((await call(w, '/devices', asBearer(forge(JWT_SECRET, head, claims)))).status, 200)
    assert.equal((await call(w, '/devices', asBearer(forge(JWT_SECRET, head, { ...claims, aud: 'other-app' })))).status, 401)
    assert.equal((await call(w, '/devices', asBearer(forge(JWT_SECRET, head, { ...claims, iss: 'https://other.example' })))).status, 401)
    assert.equal((await call(w, '/devices', asBearer(forge(JWT_SECRET, { ...head, kid: '2' }, claims)))).status, 401)
    assert.equal((await call(w, '/devices', asBearer(forge(JWT_SECRET, head, { ...claims, sub: 'someone-else' })))).status, 401)
  }))

test('the old token shape is accepted only while its exp is within one access-token lifetime', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    const head = { alg: 'HS256', typ: 'JWT' }
    const legacy = exp => forge(JWT_SECRET, head, { sub: 'owner', dev: s.deviceId, iat: nowS(), exp })
    assert.equal((await call(w, '/devices', asBearer(legacy(nowS() + 600)))).status, 200)
    assert.equal((await call(w, '/devices', asBearer(legacy(nowS() + 3600)))).status, 401)
    assert.equal((await call(w, '/devices', asBearer(legacy(nowS() - 10)))).status, 401)
    // The old shape with an aud from another app is not "legacy".
    const other = forge(JWT_SECRET, head, { sub: 'owner', aud: 'other-app', dev: s.deviceId, iat: nowS(), exp: nowS() + 600 })
    assert.equal((await call(w, '/devices', asBearer(other))).status, 401)
  }))

test('JWT_SECRET_PREVIOUS verifies tokens during a rotation; new tokens use JWT_SECRET', () => {
  const NEXT = 'next-test-jwt-secret-not-a-real-key-0123456789'
  return withWorker({ bindings: { JWT_SECRET: NEXT, JWT_SECRET_PREVIOUS: JWT_SECRET } }, async w => {
    const s = await signIn(w)
    const [h, p, sig] = s.accessToken.split('.')
    assert.equal(sig, createHmac('sha256', NEXT).update(`${h}.${p}`).digest('base64url'))
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
    const head = { alg: 'HS256', typ: 'JWT', kid: '1' }
    assert.equal((await call(w, '/devices', asBearer(forge(JWT_SECRET, head, claims)))).status, 200)
    assert.equal((await call(w, '/devices', asBearer(forge('some-other-secret-0123456789abcdef0123', head, claims)))).status, 401)
  })
})

test('a short JWT_SECRET_PREVIOUS refuses to run', () =>
  withWorker({ bindings: { JWT_SECRET_PREVIOUS: 'short' } }, async w => {
    const res = await call(w, '/devices')
    assert.equal(res.status, 500)
    assert.match((await res.json()).message, /JWT_SECRET_PREVIOUS/)
  }))

test('a refresh token idle for more than 60 days is refused and its device revoked', () =>
  withWorker({}, async w => {
    const idle = await signIn(w, 'Old laptop')
    const other = await signIn(w, 'Desktop')
    await authSql(w, 'UPDATE devices SET last_seen_at = ? WHERE id = ?', Date.now() - 61 * 86_400_000, idle.deviceId)
    assert.equal((await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: idle.refreshToken } })).status, 401)
    const list = await (await call(w, '/devices', asBearer(other.accessToken))).json()
    assert.deepEqual(list.map(d => d.name), ['Desktop'])
    assert.equal((await call(w, '/devices', asBearer(idle.accessToken))).status, 401)
    // A device seen recently still refreshes.
    assert.equal((await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: other.refreshToken } })).status, 200)
  }))

test('REFRESH_IDLE_DAYS changes the idle limit', () =>
  withWorker({ bindings: { REFRESH_IDLE_DAYS: '90' } }, async w => {
    const s = await signIn(w)
    await authSql(w, 'UPDATE devices SET last_seen_at = ? WHERE id = ?', Date.now() - 61 * 86_400_000, s.deviceId)
    assert.equal((await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } })).status, 200)
  }))

test('the sign-in email states LINK_TTL_SECONDS in minutes', () =>
  withWorker({ bindings: { LINK_TTL_SECONDS: '600' } }, async w => {
    await call(w, '/auth/start', startBody(OWNER))
    await waitFor(() => w.emails.length > 0)
    assert.match(w.emails[0].body.text, /expires in 10 minutes/)
  }))
