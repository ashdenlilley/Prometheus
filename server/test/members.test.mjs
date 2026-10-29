import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withWorker, call, signIn, invite, accept, join, openSocket, hello, waitFor, OWNER } from './helpers.mjs'

const as = access => ({ authorization: `Bearer ${access}` })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ANN = 'ann@example.com'

test('owner invite emails the invitee a link to /invite', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const { res, token } = await invite(w, owner.accessToken, { email: ANN, role: 'member' })
    assert.equal(res.status, 201)
    const sent = w.emails.at(-1)
    assert.deepEqual(sent.body.to, [ANN])
    assert.match(/https?:\/\/\S+/.exec(sent.body.text)[0], /\/invite\?t=/)
    assert.ok(token)
  }))

test('GET /invite shows the page without consuming the invite', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const { token } = await invite(w, owner.accessToken, { email: ANN, role: 'member' })
    const page = await call(w, `/invite?t=${token}`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /ann@example\.com/)
    assert.equal((await accept(w, token)).status, 200)
  }))

test('accepted invitee signs in and /me shows the role', () =>
  withWorker({}, async w => {
    const ann = await join(w, ANN, 'member')
    const me = await (await call(w, '/me', { headers: as(ann.accessToken) })).json()
    assert.equal(me.email, ANN)
    assert.equal(me.role, 'member')
  }))

test('an invite is single use', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const { token } = await invite(w, owner.accessToken, { email: ANN, role: 'member' })
    assert.equal((await accept(w, token)).status, 200)
    assert.equal((await accept(w, token)).status, 400)
  }))

test('an expired invite is refused and sign-in sends no email', () =>
  withWorker({ bindings: { INVITE_TTL_SECONDS: '1' } }, async w => {
    const owner = await signIn(w)
    const { token } = await invite(w, owner.accessToken, { email: ANN, role: 'member' })
    await sleep(1200)
    assert.equal((await accept(w, token)).status, 400)
    const before = w.emails.length
    assert.equal((await call(w, '/auth/start', { method: 'POST', body: { email: ANN } })).status, 200)
    await sleep(100)
    assert.equal(w.emails.length, before)
  }))

test('sign-in for an email other than the invited one sends no email', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    await invite(w, owner.accessToken, { email: ANN, role: 'member' })
    const before = w.emails.length
    assert.equal((await call(w, '/auth/start', { method: 'POST', body: { email: 'bob@example.com' } })).status, 200)
    await sleep(100)
    assert.equal(w.emails.length, before)
  }))

test('a non-owner cannot invite', () =>
  withWorker({}, async w => {
    const ann = await join(w, ANN, 'member')
    const res = await call(w, '/invites', { method: 'POST', body: { email: 'bob@example.com', role: 'viewer' }, headers: as(ann.accessToken) })
    assert.equal(res.status, 403)
  }))

test('invites are rate limited per email', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const statuses = []
    let last
    for (let i = 0; i < 6; i++) {
      last = await call(w, '/invites', { method: 'POST', body: { email: ANN, role: 'member' }, headers: as(owner.accessToken) })
      statuses.push(last.status)
    }
    assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429])
    assert.ok(Number(last.headers.get('retry-after')) > 0)
  }))

test('inviting an existing member or the owner is refused with 409', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    assert.equal((await invite(w, owner.accessToken, { email: OWNER, role: 'member' })).res.status, 409)
    await join(w, ANN, 'member')
    assert.equal((await invite(w, owner.accessToken, { email: ANN, role: 'viewer' })).res.status, 409)
  }))

test('PATCH changes the role, reflected in /me, and the owner cannot be edited', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const ann = await join(w, ANN, 'member')
    const { userId } = await (await call(w, '/me', { headers: as(ann.accessToken) })).json()
    const res = await call(w, `/members/${userId}`, { method: 'PATCH', body: { role: 'viewer' }, headers: as(owner.accessToken) })
    assert.equal(res.status, 200)
    const me = await (await call(w, '/me', { headers: as(ann.accessToken) })).json()
    assert.equal(me.role, 'viewer')
    assert.equal((await call(w, '/members/owner', { method: 'PATCH', body: { role: 'member' }, headers: as(owner.accessToken) })).status, 404)
  }))

test('DELETE member signs them out and closes their open sync socket', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const ann = await join(w, ANN, 'member')
    const { userId } = await (await call(w, '/me', { headers: as(ann.accessToken) })).json()
    const sock = await openSocket(w, ann.accessToken)
    assert.equal(sock.status, 101)
    await hello(sock)
    assert.equal((await call(w, `/members/${userId}`, { method: 'DELETE', headers: as(owner.accessToken) })).status, 200)
    await waitFor(() => sock.closeCode === 4001)
    assert.equal((await call(w, '/auth/refresh', { method: 'POST', body: { refreshToken: ann.refreshToken } })).status, 401)
    assert.equal((await call(w, '/me', { headers: as(ann.accessToken) })).status, 401)
  }))

test('members only see their own devices', () =>
  withWorker({}, async w => {
    const owner = await signIn(w, 'Desk')
    const ann = await join(w, ANN, 'member')
    const ownerIds = (await (await call(w, '/devices', { headers: as(owner.accessToken) })).json()).map(d => d.id)
    assert.ok(ownerIds.includes(owner.deviceId))
    assert.ok(!ownerIds.includes(ann.deviceId))
    const annIds = (await (await call(w, '/devices', { headers: as(ann.accessToken) })).json()).map(d => d.id)
    assert.deepEqual(annIds, [ann.deviceId])
  }))

test('GET /members hides emails from members but not from the owner', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const ann = await join(w, ANN, 'member')
    const asOwner = await (await call(w, '/members', { headers: as(owner.accessToken) })).json()
    assert.ok(asOwner.members.some(m => m.email === ANN))
    const asAnn = await (await call(w, '/members', { headers: as(ann.accessToken) })).json()
    assert.ok(asAnn.members.length >= 2)
    assert.ok(asAnn.members.every(m => !('email' in m)))
    assert.equal(asAnn.invites, undefined)
  }))
