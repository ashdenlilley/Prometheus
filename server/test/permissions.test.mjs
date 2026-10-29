import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ackFor, call, hello, hlc, join, openSocket, signIn, waitFor, withWorker } from './helpers.mjs'

// Ops are stamped in the past so they pass the clock-skew check; k orders them.
const T = Date.now() - 60_000
const make = (k, table, id, set) => ({ hlc: hlc(T + k, 0, 'owner'), table, id, create: true, set })
const edit = (k, table, id, set, dev = 'owner') => ({ hlc: hlc(T + k, 0, dev), table, id, set })
const push = (sock, id, ops) => sock.send({ type: 'push', id, ops })
const auth = token => ({ authorization: `Bearer ${token}` })
const me = async (w, token) => (await call(w, '/me', { headers: auth(token) })).json()
// Row ids a socket was sent, from its snapshot and catch-up frames.
const ids = sock => [...sock.ofType('snapshot').flatMap(f => f.ops), ...sock.ofType('ops').flatMap(f => f.ops.map(o => o.op))].map(o => o.id)
const connect = async (w, token) => {
  const sock = await openSocket(w, token)
  await hello(sock)
  return sock
}

// Owner data: space s1; open project p1 with issue i1; restricted project p2 (nobody granted) with issue i2; an initiative.
async function seed(w, owner) {
  const os = await connect(w, owner.accessToken)
  push(os, 'seed', [
    make(1, 'spaces', 's1', { name: 'Space' }),
    make(2, 'projects', 'p1', { name: 'P1' }),
    make(3, 'projects', 'p2', { name: 'P2', access: { mode: 'restricted', users: [] } }),
    make(4, 'issues', 'i1', { projectId: 'p1', title: 'one' }),
    make(5, 'issues', 'i2', { projectId: 'p2', title: 'two' }),
    make(6, 'initiatives', 'in1', { name: 'Init' })
  ])
  await ackFor(os, 'seed')
  return os
}

test('a viewer write is refused and nothing is stored; the owner sees the denial, members get 403', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    await seed(w, owner)
    const v = await join(w, 'viewer@example.test', 'viewer', [])
    const vs = await connect(w, v.accessToken)
    push(vs, 'v1', [make(10, 'issues', 'ghost', { projectId: 'p1', title: 'no' })])
    const err = await ackFor(vs, 'v1')
    assert.equal(err.type, 'error')
    assert.equal(err.code, 'forbidden')
    assert.equal(err.index, 0)

    assert.ok(!ids(await connect(w, owner.accessToken)).includes('ghost'))
    const log = await (await call(w, '/audit/denials', { headers: auth(owner.accessToken) })).json()
    assert.equal(log[0].user, (await me(w, v.accessToken)).userId)
    assert.equal(log[0].table, 'issues')
    assert.equal(log[0].row, 'ghost')

    const member = await join(w, 'member@example.test', 'member', [])
    assert.equal((await call(w, '/audit/denials', { headers: auth(member.accessToken) })).status, 403)
  }))

test('members edit rows they can see; only the owner changes project access and webhooks', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const os = await seed(w, owner)
    const m = await join(w, 'member@example.test', 'member', [])
    const ms = await connect(w, m.accessToken)

    push(ms, 'm1', [edit(20, 'issues', 'i1', { title: 'edited' }, 'member')])
    assert.equal((await ackFor(ms, 'm1')).type, 'ack')
    push(ms, 'm2', [edit(21, 'projects', 'p1', { access: { mode: 'restricted', users: [] } }, 'member')])
    assert.equal((await ackFor(ms, 'm2')).code, 'forbidden')
    push(ms, 'm3', [make(22, 'webhooks', 'wh1', { projectId: 'p1', url: 'https://example.test/hook' })])
    assert.equal((await ackFor(ms, 'm3')).code, 'forbidden')

    push(os, 'o1', [edit(23, 'projects', 'p1', { access: { mode: 'open', users: [] } })])
    assert.equal((await ackFor(os, 'o1')).type, 'ack')
    push(os, 'o2', [make(24, 'webhooks', 'wh1', { projectId: 'p1', url: 'https://example.test/hook' })])
    assert.equal((await ackFor(os, 'o2')).type, 'ack')
  }))

test('a restricted project is hidden from members until granted, and so are its issues', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const os = await seed(w, owner)
    const m = await join(w, 'member@example.test', 'member', [])
    const ms = await connect(w, m.accessToken)
    assert.ok(ids(ms).includes('p1') && ids(ms).includes('i1'))
    assert.ok(!ids(ms).includes('p2') && !ids(ms).includes('i2'))

    push(ms, 'm1', [edit(20, 'issues', 'i2', { title: 'sneaky' }, 'member')])
    assert.equal((await ackFor(ms, 'm1')).code, 'forbidden')

    const { userId } = await me(w, m.accessToken)
    push(os, 'grant', [edit(21, 'projects', 'p2', { access: { mode: 'restricted', users: [userId] } })])
    await ackFor(os, 'grant')
    const again = await connect(w, m.accessToken)
    assert.ok(ids(again).includes('p2') && ids(again).includes('i2'))
  }))

test('a guest sees its granted projects and the spaces; it edits there and nowhere else', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    await seed(w, owner)
    const g = await join(w, 'guest@example.test', 'guest', ['p1'])
    const gs = await connect(w, g.accessToken)
    assert.ok(ids(gs).includes('s1') && ids(gs).includes('p1') && ids(gs).includes('i1'))
    assert.ok(!ids(gs).includes('p2') && !ids(gs).includes('i2') && !ids(gs).includes('in1'))

    push(gs, 'g1', [edit(20, 'issues', 'i1', { title: 'guest edit' }, 'guest')])
    assert.equal((await ackFor(gs, 'g1')).type, 'ack')
    push(gs, 'g2', [make(21, 'issues', 'g-new', { projectId: 'p2', title: 'x' })])
    assert.equal((await ackFor(gs, 'g2')).code, 'forbidden')
    push(gs, 'g3', [edit(22, 'projects', 'p1', { name: 'renamed' }, 'guest')])
    assert.equal((await ackFor(gs, 'g3')).code, 'forbidden')
  }))

test('live ops reach only the sockets that can read them', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const os = await seed(w, owner)
    const m = await join(w, 'member@example.test', 'member', [])
    const ms = await connect(w, m.accessToken)
    push(os, 'o1', [make(20, 'issues', 'i3', { projectId: 'p2', title: 'hidden' })])
    await ackFor(os, 'o1')
    push(os, 'o2', [make(21, 'issues', 'i4', { projectId: 'p1', title: 'open' })])
    await ackFor(os, 'o2')
    await waitFor(() => ids(ms).includes('i4'))
    assert.ok(!ids(ms).includes('i3'))
  }))

test("moving an issue out of a member's reach closes their socket; a resync no longer has it", () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const os = await seed(w, owner)
    const m = await join(w, 'member@example.test', 'member', [])
    const ms = await connect(w, m.accessToken)
    push(os, 'move', [edit(20, 'issues', 'i1', { projectId: 'p2' })])
    await ackFor(os, 'move')
    await waitFor(() => ms.closeCode === 4003)
    assert.ok(!ids(await connect(w, m.accessToken)).includes('i1'))
  }))

test('a snapshot for a guest leaves out ungranted projects and their rows', () =>
  withWorker({ bindings: { COMPACT_AT: '5', COMPACT_KEEP: '2' } }, async w => {
    const owner = await signIn(w)
    const os = await connect(w, owner.accessToken)
    // Six ops in one push: over COMPACT_AT, so the older ones fold into the snapshot.
    push(os, 'seed', [
      make(1, 'projects', 'p1', { name: 'P1' }),
      make(2, 'projects', 'p2', { name: 'P2', access: { mode: 'restricted', users: [] } }),
      make(3, 'issues', 'i1', { projectId: 'p1', title: 'one' }),
      make(4, 'issues', 'i2', { projectId: 'p2', title: 'two' }),
      edit(5, 'issues', 'i2', { title: 'two again' }),
      edit(6, 'issues', 'i1', { title: 'one again' })
    ])
    await ackFor(os, 'seed')
    const g = await join(w, 'guest@example.test', 'guest', ['p1'])
    const gs = await connect(w, g.accessToken)
    assert.ok(gs.ofType('snapshot').length >= 1)
    assert.ok(ids(gs).includes('i1'))
    assert.ok(!ids(gs).includes('i2') && !ids(gs).includes('p2'))
  }))

test('a role change closes the open socket; after reconnecting the member is read-only', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    await seed(w, owner)
    const m = await join(w, 'member@example.test', 'member', [])
    const ms = await connect(w, m.accessToken)
    const { userId } = await me(w, m.accessToken)
    const res = await call(w, `/members/${userId}`, { method: 'PATCH', body: { role: 'viewer' }, headers: auth(owner.accessToken) })
    assert.equal(res.status, 200)
    await waitFor(() => ms.closeCode === 4003)

    const again = await openSocket(w, m.accessToken)
    assert.equal((await hello(again)).role, 'viewer')
    push(again, 'v1', [edit(20, 'issues', 'i1', { title: 'x' }, 'member')])
    assert.equal((await ackFor(again, 'v1')).code, 'forbidden')
  }))

test('presence shows who is on which issue, filtered by what each reader may see', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const os = await seed(w, owner)
    const m = await join(w, 'member@example.test', 'member', [])
    const { userId } = await me(w, m.accessToken)
    const ms = await connect(w, m.accessToken)
    const g = await join(w, 'guest@example.test', 'guest', [])
    const gs = await connect(w, g.accessToken)

    const gb = gs.ofType('presence').length
    ms.send({ type: 'presence', issueId: 'i1' })
    await waitFor(() => os.ofType('presence').some(f => f.users.some(u => u.userId === userId && u.issueId === 'i1')))
    await waitFor(() => gs.ofType('presence').length > gb)
    assert.ok(!gs.ofType('presence').at(-1).users.some(u => u.userId === userId))

    const n = os.ofType('presence').length
    ms.ws.close()
    await waitFor(() => os.ofType('presence').length > n)
    assert.ok(!os.ofType('presence').at(-1).users.some(u => u.userId === userId))
  }))

test('the owner sees and writes every row, restricted ones included', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const os = await seed(w, owner)
    const probe = await connect(w, owner.accessToken)
    assert.ok(ids(probe).includes('p2') && ids(probe).includes('i2') && ids(probe).includes('in1'))
    push(os, 'o3', [edit(30, 'issues', 'i2', { title: 'owner edit' })])
    assert.equal((await ackFor(os, 'o3')).type, 'ack')
  }))
