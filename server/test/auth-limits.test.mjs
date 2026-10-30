import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, OWNER, authSql, call, lastToken, signIn, waitFor, withWorker } from './helpers.mjs'

const start = { email: OWNER, deviceName: 'Laptop' }

test('the confirm page times the start with a nonce-locked script, and each load gets a new nonce', () =>
  withWorker({}, async w => {
    const before = w.emails.length
    await call(w, '/auth/start', { method: 'POST', body: start })
    await waitFor(() => w.emails.length > before)
    const t = lastToken(w)
    const nonces = []
    for (let i = 0; i < 2; i++) {
      const res = await call(w, `/auth/verify?t=${t}`)
      assert.equal(res.status, 200)
      const html = await res.text()
      const time = /<time datetime="([^"]+)">/.exec(html)
      assert.ok(time && !Number.isNaN(Date.parse(time[1])) && time[1].endsWith('Z'), html)
      const script = /<script nonce="([^"]+)">/.exec(html)
      assert.ok(script, html)
      const csp = res.headers.get('content-security-policy')
      const scriptSrc = /script-src ([^;]*)/.exec(csp)[1]
      assert.equal(scriptSrc, `'nonce-${script[1]}'`)
      assert.ok(!scriptSrc.includes('unsafe-inline'))
      nonces.push(script[1])
    }
    assert.notEqual(nonces[0], nonces[1])
  }))

test('a JSON body over 16 KiB is refused with 413', () =>
  withWorker({}, async w => {
    const res = await call(w, '/auth/start', { method: 'POST', body: { ...start, deviceName: 'x'.repeat(17 * 1024) } })
    assert.equal(res.status, 413)
    assert.deepEqual(await res.json(), { error: 'too_large' })
  }))

test('a chunked body with no Content-Length is refused with 413', () =>
  withWorker({}, async w => {
    // A stream has no known length, so the request goes out without Content-Length.
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(JSON.stringify(start)))
        c.close()
      }
    })
    const res = await w.mf.dispatchFetch(BASE + '/auth/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' })
    assert.equal(res.status, 413)
  }))

test('a small sign-in start is still accepted', () =>
  withWorker({}, async w => {
    const res = await call(w, '/auth/start', { method: 'POST', body: start })
    assert.equal(res.status, 200)
    assert.ok((await res.json()).requestId)
  }))

test('bearer failures from one IP are limited to 3 then 429, and another IP is unaffected', () =>
  withWorker({ ratelimits: { AUTH_RL: { namespace_id: '1001', simple: { limit: 3, period: 60 } } } }, async w => {
    const me = await signIn(w)
    const bad = { headers: { authorization: 'Bearer not-a-token' }, ip: '203.0.113.9' }
    const statuses = []
    let last
    for (let i = 0; i < 4; i++) {
      last = await call(w, '/me', bad)
      statuses.push(last.status)
    }
    assert.deepEqual(statuses, [401, 401, 401, 429])
    assert.equal(last.headers.get('retry-after'), '60')
    const ok = await call(w, '/me', { headers: { authorization: `Bearer ${me.accessToken}` }, ip: '198.51.100.7' })
    assert.equal(ok.status, 200)
  }))

test('alarm deletes an expired, unverified sign-in request', () =>
  withWorker({}, async w => {
    // The first start creates the Auth object's tables.
    await call(w, '/auth/start', { method: 'POST', body: start })
    const expired = Date.now() - 60_000
    await authSql(w, 'INSERT INTO requests (id, token_hash, secret_hash, device_name, owner, created_at, expires_at, verified) VALUES (?, ?, ?, ?, 0, ?, ?, 0)', 'stale', 'th-stale', 'sh-stale', 'Old', expired - 1000, expired)
    // alarm() is reserved and not callable over RPC; it only calls prune() and reschedules.
    const ns = await w.mf.getDurableObjectNamespace('AUTH')
    await ns.get(ns.idFromName('auth')).prune()
    const left = (await authSql(w, "SELECT id FROM requests WHERE id = 'stale'"))
    assert.equal(left.length, 0)
  }))

const other = { email: 'nobody@example.com', deviceName: 'Laptop' }

test('a non-member start stores no request row', () =>
  withWorker({}, async w => {
    // The member start creates the Auth object's tables.
    await call(w, '/auth/start', { method: 'POST', body: start })
    const before = (await authSql(w, 'SELECT COUNT(*) AS n FROM requests'))[0].n
    const res = await call(w, '/auth/start', { method: 'POST', body: other })
    assert.equal(res.status, 200)
    assert.equal((await authSql(w, 'SELECT COUNT(*) AS n FROM requests'))[0].n, before)
  }))

test('a non-member and a member get the same start reply shape, and poll the same way while pending', () =>
  withWorker({}, async w => {
    const member = await (await call(w, '/auth/start', { method: 'POST', body: start })).json()
    const stranger = await (await call(w, '/auth/start', { method: 'POST', body: other })).json()
    assert.deepEqual(Object.keys(stranger).sort(), Object.keys(member).sort())
    assert.match(stranger.code, /^\d{6}$/)
    assert.match(member.code, /^\d{6}$/)
    for (const s of [member, stranger]) {
      const res = await call(w, '/auth/poll', { method: 'POST', body: { requestId: s.requestId, pollSecret: s.pollSecret } })
      assert.equal(res.status, 202)
      assert.deepEqual(await res.json(), { status: 'pending' })
    }
  }))

test('after the link TTL, a non-member and a member poll both get 410 gone', () =>
  withWorker({ bindings: { LINK_TTL_SECONDS: '1' } }, async w => {
    const member = await (await call(w, '/auth/start', { method: 'POST', body: start })).json()
    const stranger = await (await call(w, '/auth/start', { method: 'POST', body: other })).json()
    await new Promise(r => setTimeout(r, 1200))
    for (const s of [member, stranger]) {
      const res = await call(w, '/auth/poll', { method: 'POST', body: { requestId: s.requestId, pollSecret: s.pollSecret } })
      assert.equal(res.status, 410)
      assert.deepEqual(await res.json(), { error: 'gone' })
    }
  }))

test('a wrong pollSecret is 404 for a non-member and a member alike, and a tampered requestId is 404', () =>
  withWorker({}, async w => {
    const member = await (await call(w, '/auth/start', { method: 'POST', body: start })).json()
    const stranger = await (await call(w, '/auth/start', { method: 'POST', body: other })).json()
    for (const s of [member, stranger]) {
      const res = await call(w, '/auth/poll', { method: 'POST', body: { requestId: s.requestId, pollSecret: 'not-the-secret' } })
      assert.equal(res.status, 404)
      assert.deepEqual(await res.json(), { error: 'not_found' })
    }

    // Changing the last character of the signature breaks it.
    const id = stranger.requestId
    const tampered = id.slice(0, -1) + (id.endsWith('A') ? 'B' : 'A')
    const res = await call(w, '/auth/poll', { method: 'POST', body: { requestId: tampered, pollSecret: stranger.pollSecret } })
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'not_found' })
  }))
