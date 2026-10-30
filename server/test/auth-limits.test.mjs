import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BASE, OWNER, authSql, call, signIn, withWorker } from './helpers.mjs'

const start = { email: OWNER, deviceName: 'Laptop' }

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
