import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ackFor, hello, hlc, join, openSocket, signIn, waitFor, withWorker } from './helpers.mjs'

// Ops are stamped in the past so they pass the clock-skew check; k orders them.
const T = Date.now() - 60_000
const make = (k, table, id, set) => ({ hlc: hlc(T + k, 0, 'owner'), table, id, create: true, set })
const edit = (k, table, id, set, dev = 'owner') => ({ hlc: hlc(T + k, 0, dev), table, id, set })
const push = (sock, id, ops) => sock.send({ type: 'push', id, ops })
const connect = async (w, token) => {
  const sock = await openSocket(w, token)
  await hello(sock)
  return sock
}
// Values of an issue as a socket was sent them, from its snapshot and catch-up frames.
const valuesOf = (sock, id = 'i1') => [...sock.ofType('snapshot').flatMap(f => f.ops), ...sock.ofType('ops').flatMap(f => f.ops.map(o => o.op))]
  .filter(o => o.table === 'issues' && o.id === id && o.set?.values !== undefined).map(o => o.set.values)

const COLS = [
  { id: 'c1', name: 'Budget', access: { readOnlyFor: ['member'] } },
  { id: 'c2', name: 'Salary', access: { hiddenFor: ['member', 'guest'] } },
  { id: 'c3', name: 'Notes' }
]

// Owner data: project p1 with custom columns; issue i1 in it with values.
async function seed(w, owner) {
  const os = await connect(w, owner.accessToken)
  push(os, 'seed', [
    make(1, 'projects', 'p1', { name: 'P1', columns: COLS }),
    make(2, 'issues', 'i1', { projectId: 'p1', title: 'one', values: { c1: 5, c2: 100, c3: 'x' } })
  ])
  await ackFor(os, 'seed')
  return os
}

test("a member's catch-up leaves out hidden values; the owner's keeps them", () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    await seed(w, owner)
    const m = await join(w, 'member@example.test', 'member', [])
    const ms = await connect(w, m.accessToken)
    assert.ok(valuesOf(ms).length > 0)
    for (const v of valuesOf(ms)) assert.ok(!('c2' in v))
    assert.equal(valuesOf(await connect(w, owner.accessToken)).at(-1).c2, 100)
  }))

test('a member edits visible values; the hidden value survives the write', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    await seed(w, owner)
    const m = await join(w, 'member@example.test', 'member', [])
    const ms = await connect(w, m.accessToken)
    push(ms, 'm1', [edit(10, 'issues', 'i1', { values: { c1: 5, c3: 'y' } }, 'member')])
    assert.equal((await ackFor(ms, 'm1')).type, 'ack')
    const os = await connect(w, owner.accessToken)
    assert.deepEqual(valuesOf(os).at(-1), { c1: 5, c2: 100, c3: 'y' })
  }))

test('a member cannot change a read-only or a hidden column', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    await seed(w, owner)
    const m = await join(w, 'member@example.test', 'member', [])
    const ms = await connect(w, m.accessToken)
    push(ms, 'm1', [edit(10, 'issues', 'i1', { values: { c1: 6, c3: 'x' } }, 'member')])
    const ro = await ackFor(ms, 'm1')
    assert.equal(ro.code, 'forbidden')
    assert.match(ro.message, /read-only/)
    push(ms, 'm2', [edit(11, 'issues', 'i1', { values: { c1: 5, c2: 1, c3: 'x' } }, 'member')])
    const hid = await ackFor(ms, 'm2')
    assert.equal(hid.code, 'forbidden')
    assert.match(hid.message, /hidden/)
  }))

test('a guest granted the project edits visible values; hidden ones never reach it live', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const os = await seed(w, owner)
    const g = await join(w, 'guest@example.test', 'guest', ['p1'])
    const gs = await connect(w, g.accessToken)
    push(gs, 'g1', [edit(10, 'issues', 'i1', { values: { c1: 5, c3: 'z' } }, 'guest')])
    assert.equal((await ackFor(gs, 'g1')).type, 'ack')

    push(os, 'o1', [edit(11, 'issues', 'i1', { values: { c1: 5, c2: 200, c3: 'w' } })])
    await ackFor(os, 'o1')
    await waitFor(() => valuesOf(gs).some(v => v.c3 === 'w'))
    for (const v of valuesOf(gs)) assert.ok(!('c2' in v))

    const v = await join(w, 'viewer@example.test', 'viewer', [])
    const vs = await connect(w, v.accessToken)
    push(vs, 'v1', [edit(12, 'issues', 'i1', { values: { c1: 5, c3: 'q' } }, 'viewer')])
    assert.equal((await ackFor(vs, 'v1')).code, 'forbidden')
  }))

test('a member cannot change a column rule, but can add a plain column', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    await seed(w, owner)
    const m = await join(w, 'member@example.test', 'member', [])
    const ms = await connect(w, m.accessToken)
    push(ms, 'm1', [edit(10, 'projects', 'p1', { columns: [{ id: 'c1', name: 'Budget' }, COLS[1], COLS[2]] }, 'member')])
    assert.equal((await ackFor(ms, 'm1')).code, 'forbidden')
    push(ms, 'm2', [edit(11, 'projects', 'p1', { columns: [...COLS, { id: 'c4', name: 'Extra' }] }, 'member')])
    assert.equal((await ackFor(ms, 'm2')).type, 'ack')
  }))

test('changing a column rule closes a connected member', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const os = await seed(w, owner)
    const m = await join(w, 'member@example.test', 'member', [])
    const ms = await connect(w, m.accessToken)
    const hiddenC3 = [...COLS.slice(0, 2), { id: 'c3', name: 'Notes', access: { hiddenFor: ['member'] } }]
    push(os, 'o1', [edit(10, 'projects', 'p1', { columns: hiddenC3 })])
    assert.equal((await ackFor(os, 'o1')).type, 'ack')
    await waitFor(() => ms.closeCode === 4003)
  }))
