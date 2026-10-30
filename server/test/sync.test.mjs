import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ackFor, call, hello, hlc, openSocket, signIn, ticket, waitFor, withWorker } from './helpers.mjs'

const create = (ms, id, title) => ({ hlc: hlc(ms, 0, 'dev'), table: 'issues', id, create: true, set: { title } })
const setTitle = (ms, id, title) => ({ hlc: hlc(ms, 0, 'dev'), table: 'issues', id, set: { title } })
const push = (sock, id, ops) => sock.send({ type: 'push', id, ops })

test('upgrade needs a ticket: no protocol, ?access_token= and garbage are refused', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    assert.equal((await openSocket(w, null)).status, 401)
    assert.equal((await openSocket(w, null, `?access_token=${s.accessToken}`)).status, 401)
    assert.equal((await openSocket(w, null, '', { protocol: 'prometheus-sync, ticket.garbage' })).status, 401)
    const ok = await openSocket(w, s.accessToken)
    assert.equal(ok.status, 101)
    assert.equal((await hello(ok, 0)).head, 0)
  }))

test('a ticket opens a socket once; a second use is refused', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    const protocol = `prometheus-sync, ticket.${await ticket(w, s.accessToken)}`
    assert.equal((await openSocket(w, null, '', { protocol })).status, 101)
    assert.equal((await openSocket(w, null, '', { protocol })).status, 401)
  }))

test('an expired ticket is refused', () =>
  withWorker({ bindings: { SYNC_TICKET_TTL_SECONDS: '0' } }, async w => {
    const s = await signIn(w)
    assert.equal((await openSocket(w, s.accessToken)).status, 401)
  }))

test('/sync/ticket needs a bearer token', () =>
  withWorker({}, async w => {
    assert.equal((await call(w, '/sync/ticket', { method: 'POST' })).status, 401)
  }))

test('a ticket for a revoked device is refused', () =>
  withWorker({}, async w => {
    const a = await signIn(w, 'Laptop')
    const b = await signIn(w, 'Phone')
    const protocol = `prometheus-sync, ticket.${await ticket(w, b.accessToken)}`
    const del = await call(w, `/devices/${b.deviceId}`, { method: 'DELETE', headers: { authorization: `Bearer ${a.accessToken}` } })
    assert.equal(del.status, 200)
    assert.equal((await openSocket(w, null, '', { protocol })).status, 401)
  }))

test('the deprecated bearer. protocol still opens a socket', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    assert.equal((await openSocket(w, s.accessToken, '', { bearer: true })).status, 101)
    assert.equal((await openSocket(w, 'garbage', '', { bearer: true })).status, 401)
  }))

test('hello on an empty log is ready at head 0; ping gets pong', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    const sock = await openSocket(w, s.accessToken)
    assert.equal((await hello(sock, 0)).head, 0)
    sock.send({ type: 'ping' })
    await waitFor(() => sock.ofType('pong').length === 1)
  }))

test('push is acked with seqs and broadcast to the other device only, with a catch-up for late joiners', () =>
  withWorker({}, async w => {
    const a = await signIn(w, 'Laptop')
    const b = await signIn(w, 'Phone')
    const sa = await openSocket(w, a.accessToken)
    const sb = await openSocket(w, b.accessToken)
    await hello(sa)
    await hello(sb)

    push(sa, 'p1', [create(1000, 'i1', 'first'), setTitle(1001, 'i1', 'second')])
    const ack = await ackFor(sa, 'p1')
    assert.deepEqual(ack.seqs, [1, 2])
    assert.equal(ack.head, 2)

    await waitFor(() => sb.ofType('ops').length === 1)
    const got = sb.ofType('ops')[0]
    assert.deepEqual(got.ops.map(o => o.seq), [1, 2])
    assert.equal(got.head, 2)
    assert.equal(sa.ofType('ops').length, 0, 'sender does not get its own ops back')

    const late = await openSocket(w, b.accessToken)
    assert.equal((await hello(late, 0)).head, 2)
    assert.deepEqual(late.ofType('ops').flatMap(f => f.ops.map(o => o.seq)), [1, 2])
  }))

test('a push with a clock more than 5 minutes ahead is rejected whole', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    const sock = await openSocket(w, s.accessToken)
    await hello(sock)
    push(sock, 'skewed', [create(1000, 'ok', 'fine'), create(Date.now() + 6 * 60_000, 'future', 'nope')])
    const err = await ackFor(sock, 'skewed')
    assert.equal(err.type, 'error')
    assert.equal(err.code, 'skew')
    assert.ok(err.skewMs > 5 * 60_000)

    const probe = await openSocket(w, s.accessToken)
    assert.equal((await hello(probe, 0)).head, 0)
  }))

test('invalid ops are rejected whole with the op index', () =>
  withWorker({}, async w => {
    const s = await signIn(w)
    const sock = await openSocket(w, s.accessToken)
    await hello(sock)
    const bad = [
      [{ hlc: hlc(1, 0, 'd'), table: 'not_a_table', id: 'x', set: { a: 1 } }],
      [{ hlc: 'nope', table: 'issues', id: 'x', set: { a: 1 } }],
      [{ hlc: hlc(1, 0, 'd'), table: 'issues', id: 'x', set: { $: 1 } }],
      [{ hlc: hlc(1, 0, 'd'), table: 'issues', id: '', set: { a: 1 } }],
      [{ hlc: hlc(1, 0, 'd'), table: 'issues', id: 'x' }]
    ]
    for (const [i, ops] of bad.entries()) {
      push(sock, `bad${i}`, ops)
      const err = await ackFor(sock, `bad${i}`)
      assert.equal(err.code, 'invalid', `case ${i}`)
      assert.equal(err.index, 0)
    }
    const probe = await openSocket(w, s.accessToken)
    assert.equal((await hello(probe, 0)).head, 0)
  }))

test('a duplicate push id is acked again without appending or broadcasting twice', () =>
  withWorker({}, async w => {
    const a = await signIn(w, 'Laptop')
    const b = await signIn(w, 'Phone')
    const sa = await openSocket(w, a.accessToken)
    const sb = await openSocket(w, b.accessToken)
    await hello(sa)
    await hello(sb)
    const ops = [create(1000, 'i1', 'x')]
    push(sa, 'same', ops)
    await ackFor(sa, 'same')
    sa.frames = []
    push(sa, 'same', ops)
    const again = await ackFor(sa, 'same')
    assert.deepEqual(again.seqs, [1])
    assert.equal(again.head, 1)
    await new Promise(r => setTimeout(r, 100))
    assert.equal(sb.ofType('ops').length, 1)

    const probe = await openSocket(w, a.accessToken)
    await hello(probe, 0)
    assert.equal(probe.ofType('ops').flatMap(f => f.ops).length, 1)
  }))

test('ops from two devices are ordered by one server sequence for every socket', () =>
  withWorker({}, async w => {
    const a = await signIn(w, 'Laptop')
    const b = await signIn(w, 'Phone')
    const sa = await openSocket(w, a.accessToken)
    const sb = await openSocket(w, b.accessToken)
    await hello(sa)
    await hello(sb)
    push(sa, 'a1', [create(1000, 'a', 'A')])
    await ackFor(sa, 'a1')
    push(sb, 'b1', [create(1001, 'b', 'B')])
    await ackFor(sb, 'b1')
    push(sa, 'a2', [setTitle(1002, 'a', 'A2'), setTitle(1003, 'a', 'A3')])
    await ackFor(sa, 'a2')

    const view = await openSocket(w, a.accessToken)
    await hello(view, 0)
    const seqs = view.ofType('ops').flatMap(f => f.ops.map(o => o.seq))
    assert.deepEqual(seqs, [1, 2, 3, 4])
    assert.deepEqual(
      view.ofType('ops').flatMap(f => f.ops.map(o => o.op.set.title)),
      ['A', 'B', 'A2', 'A3']
    )
  }))

test('compaction folds old ops; a client with since=0 gets the snapshot, then the newest ops', () =>
  withWorker({ bindings: { COMPACT_AT: '20', COMPACT_KEEP: '5' } }, async w => {
    const s = await signIn(w)
    const sock = await openSocket(w, s.accessToken)
    await hello(sock)
    const ops = [
      { hlc: hlc(1000, 0, 'd'), table: 'issues', id: 'i2', create: true, set: { title: 'gone soon' } },
      { hlc: hlc(1001, 0, 'd'), table: 'issues', id: 'i2', set: { title: 'older edit' } },
      { hlc: hlc(1002, 0, 'd'), table: 'issues', id: 'i2', del: true },
      { hlc: hlc(1003, 0, 'd'), table: 'issues', id: 'i1', create: true, set: { title: 'v0' } }
    ]
    for (let k = 1; k <= 21; k++) ops.push(setTitle(2000 + k, 'i1', `v${k}`))
    push(sock, 'big', ops)
    assert.equal((await ackFor(sock, 'big')).head, 25)

    const late = await openSocket(w, s.accessToken)
    const ready = await hello(late, 0)
    assert.equal(ready.head, 25)
    const snapshot = late.ofType('snapshot').flatMap(f => f.ops)
    assert.ok(late.ofType('snapshot').length >= 1)
    // Deleted row: existence delete only, no fields for i2.
    assert.deepEqual(snapshot.filter(o => o.id === 'i2'), [{ hlc: hlc(1002, 0, 'd'), table: 'issues', id: 'i2', del: true }])
    // Winning field value among folded ops (seq 1..20 = v0..v16).
    const titles = snapshot.filter(o => o.id === 'i1' && o.set?.title !== undefined)
    assert.deepEqual(titles.map(o => o.set.title), ['v16'])
    const tail = late.ofType('ops').flatMap(f => f.ops)
    assert.deepEqual(tail.map(o => o.seq), [21, 22, 23, 24, 25])
    assert.equal(tail.at(-1).op.set.title, 'v21')

    const fresh = await openSocket(w, s.accessToken)
    await hello(fresh, 21)
    assert.equal(fresh.ofType('snapshot').length, 0)
    assert.deepEqual(fresh.ofType('ops').flatMap(f => f.ops.map(o => o.seq)), [22, 23, 24, 25])
  }))

test('revoking a device closes its open socket with code 4001', () =>
  withWorker({}, async w => {
    const a = await signIn(w, 'Laptop')
    const b = await signIn(w, 'Phone')
    const sb = await openSocket(w, b.accessToken)
    await hello(sb)
    const del = await call(w, `/devices/${b.deviceId}`, { method: 'DELETE', headers: { authorization: `Bearer ${a.accessToken}` } })
    assert.equal(del.status, 200)
    await waitFor(() => sb.closeCode === 4001)
  }))

test('load sanity: 3 sockets, 1,000 ops; every socket ends at the same head with every op', () =>
  withWorker({}, async w => {
    // Sequential: each sign-in reads the newest emailed link, so they cannot overlap.
    const devices = [await signIn(w, 'D1'), await signIn(w, 'D2'), await signIn(w, 'D3')]
    const socks = []
    for (const d of devices) {
      const sock = await openSocket(w, d.accessToken)
      await hello(sock)
      socks.push(sock)
    }
    const seqsOwn = [[], [], []]
    const headsOwn = [0, 0, 0]
    let next = 0
    for (let p = 0; p < 20; p++) {
      const dev = p % 3
      const ops = []
      for (let k = 0; k < 50; k++) ops.push(setTitle(Date.now(), `row-${next++ % 40}`, `t${next}`))
      push(socks[dev], `load-${p}`, ops)
      const ack = await ackFor(socks[dev], `load-${p}`)
      seqsOwn[dev].push(...ack.seqs)
      headsOwn[dev] = ack.head
    }
    assert.equal(next, 1000)

    for (const [i, sock] of socks.entries()) {
      const received = () => sock.ofType('ops').flatMap(f => f.ops.map(o => o.seq))
      await waitFor(() => new Set([...seqsOwn[i], ...received()]).size === 1000)
      assert.equal(new Set([...seqsOwn[i], ...received()]).size, 1000)
      assert.equal(Math.max(headsOwn[i], ...sock.ofType('ops').map(f => f.head)), 1000)
    }

    const fresh = await openSocket(w, devices[0].accessToken)
    const ready = await hello(fresh, 0)
    assert.equal(ready.head, 1000)
    const frames = fresh.ofType('ops')
    assert.ok(frames.every(f => f.ops.length <= 500))
    assert.deepEqual(frames.flatMap(f => f.ops.map(o => o.seq)), Array.from({ length: 1000 }, (_, i) => i + 1))
  }))

// OS-466 (security fix 5): op limits, push quotas, paged hello.
const now = () => Date.now() - 1000

test('opError: an id over 128 chars, a field value over 64 KiB, or more than 200 fields is rejected', () =>
  withWorker({}, async w => {
    const sock = await openSocket(w, (await signIn(w)).accessToken)
    await hello(sock)
    push(sock, 'id129', [setTitle(now(), 'x'.repeat(129), 't')])
    assert.deepEqual([(await ackFor(sock, 'id129')).code, (await ackFor(sock, 'id129')).message], ['invalid', 'bad id'])
    push(sock, 'id128', [setTitle(now(), 'x'.repeat(128), 't')])
    assert.equal((await ackFor(sock, 'id128')).type, 'ack')
    push(sock, 'big', [setTitle(now(), 'big', 'x'.repeat(70 * 1024))])
    assert.deepEqual([(await ackFor(sock, 'big')).code, (await ackFor(sock, 'big')).message], ['invalid', 'field value too large'])
    const set = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}`, i]))
    push(sock, 'wide', [{ hlc: hlc(now(), 0, 'dev'), table: 'issues', id: 'wide', set }])
    assert.deepEqual([(await ackFor(sock, 'wide')).code, (await ackFor(sock, 'wide')).message], ['invalid', 'too many fields'])
  }))

test('push quota: the 21st push within 10 s is rate_limited; 3 overruns in a row close the socket with 4008', () =>
  withWorker({}, async w => {
    const sock = await openSocket(w, (await signIn(w)).accessToken)
    await hello(sock)
    for (let i = 0; i < 20; i++) {
      push(sock, `q${i}`, [setTitle(now(), `r${i}`, 't')])
      assert.equal((await ackFor(sock, `q${i}`)).type, 'ack')
    }
    for (let i = 20; i < 23; i++) {
      push(sock, `q${i}`, [setTitle(now(), `r${i}`, 't')])
      const err = await ackFor(sock, `q${i}`)
      assert.deepEqual([err.type, err.code], ['error', 'rate_limited'])
    }
    await waitFor(() => sock.closeCode === 4008)
    assert.equal(sock.closeCode, 4008)
  }))

test('push quota: ops per window are capped (OPS_MAX override); the window frees up again (OPS_WINDOW_MS override)', () =>
  withWorker({ bindings: { OPS_MAX: '10', OPS_WINDOW_MS: '300' } }, async w => {
    const sock = await openSocket(w, (await signIn(w)).accessToken)
    await hello(sock)
    const ops = n => Array.from({ length: n }, (_, i) => setTitle(now(), `o${i}`, 't'))
    push(sock, 'a', ops(8))
    assert.equal((await ackFor(sock, 'a')).type, 'ack')
    push(sock, 'b', ops(3))
    assert.equal((await ackFor(sock, 'b')).code, 'rate_limited')
    await new Promise(r => setTimeout(r, 350))
    push(sock, 'c', ops(3))
    assert.equal((await ackFor(sock, 'c')).type, 'ack')
  }))

test('hello with 3,000 ops delivers every op, in order, in batches of at most 500', () =>
  withWorker({}, async w => {
    const owner = await signIn(w)
    const sock = await openSocket(w, owner.accessToken)
    await hello(sock)
    for (let p = 0; p < 3; p++) {
      push(sock, `h${p}`, Array.from({ length: 1000 }, (_, k) => setTitle(now(), `row-${k % 50}`, `t${p}-${k}`)))
      assert.equal((await ackFor(sock, `h${p}`)).type, 'ack')
    }
    const fresh = await openSocket(w, owner.accessToken)
    const ready = await hello(fresh, 0)
    assert.equal(ready.head, 3000)
    const frames = fresh.ofType('ops')
    assert.equal(frames.length, 6)
    assert.ok(frames.every(f => f.ops.length <= 500))
    assert.deepEqual(frames.flatMap(f => f.ops.map(o => o.seq)), Array.from({ length: 3000 }, (_, i) => i + 1))
  }))
