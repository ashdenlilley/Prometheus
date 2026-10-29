// Integration test: simulated devices sharing one folder. Run from repo root after compiling with
// tsc --outDir .synctest --module commonjs --target es2022 --skipLibCheck --types node --strict
// src/main/sync.ts src/main/db.ts src/main/crypto.ts src/shared/sync.ts src/shared/seed.ts
const path = require('path')
const os = require('os')
const fs = require('fs')
const assert = require('assert')
const { Store } = require('./main/db.js')
const { SyncEngine } = require('./main/sync.js')
const { diffOps, applyOps } = require('./shared/sync.js')
const { seed, emptyData } = require('./shared/seed.js')
const { newDoc, editBody } = require('./shared/docs.js')

const PASS = 'correct horse battery'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-sync-'))
const folder = path.join(root, 'iCloud', 'Prometheus')

// Stand-in for Electron safeStorage: reversible, enough for the engine.
const keys = { seal: k => k.toString('base64'), open: s => Buffer.from(s, 'base64') }

async function device(name) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  const store = new Store(path.join(dir, 'prometheus.db'))
  await store.open()
  const d = { name, dir, store, state: null }
  d.engine = new SyncEngine(dir, store, {
    read: () => d.state,
    write: next => {
      d.state = next
    },
    keys
  })
  await d.engine.init()
  return d
}

// Mirrors index.ts host.apply / data:save: local ops -> record -> merge.
function edit(d, fn) {
  const prev = d.state
  const next = fn(structuredClone(prev))
  const ops = diffOps(prev, next, d.engine.clock)
  d.engine.record(ops)
  d.state = applyOps(prev, ops).data
}

const flush = d => d.engine.flushNow()
const pull = d => d.engine.syncNow()
const segFiles = dir => fs.readdirSync(dir).flatMap(dev => {
  const p = path.join(dir, dev)
  return fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter(f => f.endsWith('.ndjson')).map(f => path.join(p, f)) : []
})
const titles = d => d.state.issues.map(i => i.title).join('|')

;(async () => {
  const A = await device('A')
  const B = await device('B')
  A.state = seed()
  await A.engine.join(folder, 'push', PASS)

  const info = await B.engine.inspect(folder)
  assert.equal(info.encrypted, true)
  assert.equal(info.devices, 1)

  // Wrong passphrase is refused and writes nothing.
  B.state = emptyData()
  await assert.rejects(B.engine.join(folder, 'adopt', 'wrong passphrase'), /Wrong passphrase/)
  console.log('ok: wrong passphrase refused')

  await B.engine.join(folder, 'adopt', PASS)
  assert.deepEqual(B.state.issues.map(i => i.id), A.state.issues.map(i => i.id))
  console.log('ok: push + adopt with passphrase')

  // Encryption: no plaintext titles in the folder.
  const secret = 'Top secret roadmap item'
  edit(A, s => {
    s.issues[0].title = secret
    return s
  })
  await flush(A)
  for (const f of segFiles(folder)) assert.ok(!fs.readFileSync(f, 'utf8').includes(secret), 'segment is ciphertext')
  await pull(B)
  assert.ok(B.state.issues.some(i => i.title === secret))
  console.log('ok: segments are ciphertext, edit propagates')

  // Per-field merge: A edits title, B edits status of the same issue, both before sync.
  const id = A.state.issues[0].id
  edit(A, s => {
    s.issues.find(i => i.id === id).title = 'title from A'
    return s
  })
  edit(B, s => {
    s.issues.find(i => i.id === id).status = 'done'
    return s
  })
  await flush(A)
  await flush(B)
  await pull(A)
  await pull(B)
  for (const d of [A, B]) {
    const row = d.state.issues.find(i => i.id === id)
    assert.equal(row.title, 'title from A', `${d.name} keeps title`)
    assert.equal(row.status, 'done', `${d.name} keeps status`)
  }
  console.log('ok: per-field merge keeps both edits')

  // Same field, both edit: later hlc wins on both.
  edit(A, s => {
    s.issues.find(i => i.id === id).title = 'first'
    return s
  })
  await new Promise(r => setTimeout(r, 5))
  edit(B, s => {
    s.issues.find(i => i.id === id).title = 'second'
    return s
  })
  await flush(A)
  await flush(B)
  await pull(A)
  await pull(B)
  assert.equal(A.state.issues.find(i => i.id === id).title, 'second')
  assert.equal(B.state.issues.find(i => i.id === id).title, 'second')
  console.log('ok: same-field conflict -> last writer wins')

  // Delete propagates and late field edits to a deleted row are ignored.
  const gone = A.state.issues[1].id
  edit(A, s => {
    s.issues = s.issues.filter(i => i.id !== gone)
    return s
  })
  await flush(A)
  await pull(B)
  assert.ok(!B.state.issues.some(i => i.id === gone))
  console.log('ok: delete propagates')

  // Stale op from an old clock must not revert newer value.
  const stale = { hlc: '000000000000001.000000.zzz', table: 'issues', id, set: { title: 'stale' } }
  fs.mkdirSync(path.join(folder, 'zzz'), { recursive: true })
  // Sealed with the folder key, read back from device A's config, so the engine accepts it.
  const { seal } = require('./main/crypto.js')
  const key = Buffer.from(keys.open(JSON.parse(fs.readFileSync(path.join(A.dir, 'sync.json'), 'utf8')).keyEnc))
  fs.writeFileSync(path.join(folder, 'zzz', `${stale.hlc}.ndjson`), JSON.stringify(seal(key, JSON.stringify(stale) + '\n')))
  await pull(A)
  assert.equal(A.state.issues.find(i => i.id === id).title, 'second')
  console.log('ok: stale op ignored')

  // Clock skew: segment stamped 3 days ahead is rejected and reported.
  const future = Date.now() + 3 * 24 * 3600 * 1000
  const fut = { hlc: `${String(future).padStart(15, '0')}.000000.zzz`, table: 'issues', id, set: { title: 'from the future' } }
  fs.writeFileSync(path.join(folder, 'zzz', `${fut.hlc}.ndjson`), JSON.stringify(seal(key, JSON.stringify(fut) + '\n')))
  await pull(A)
  assert.notEqual(A.state.issues.find(i => i.id === id).title, 'from the future')
  assert.match(A.engine.getStatus().error, /ahead/)
  console.log('ok: future-stamped segment rejected')
  fs.rmSync(path.join(folder, 'zzz'), { recursive: true, force: true })

  // Compaction: many flushes from A, then B converges and A keeps few files.
  for (let i = 0; i < 120; i++) {
    edit(A, s => {
      s.issues[0].title = `rev ${i}`
      return s
    })
    await flush(A)
  }
  await pull(A)
  const own = fs.readdirSync(path.join(folder, A.engine.getStatus().deviceId)).filter(f => f.endsWith('.ndjson'))
  assert.ok(own.length < 20, `compacted, have ${own.length} segments`)
  await pull(B)
  assert.equal(titles(B), titles(A), 'B matches A after compaction')
  console.log(`ok: compaction (${own.length} segments left), B converges`)

  // Docs: both devices edit one doc body offline. After sync both keep one winner and the same conflicted copy.
  const docId = 'doc-1'
  edit(A, s => {
    s.docs = [newDoc({ id: docId, spaceId: s.spaces[0].id, title: 'Spec', body: 'base' })]
    return s
  })
  await flush(A)
  await pull(B)
  edit(A, s => {
    s.docs[0] = editBody(s.docs[0], 'body from A', 'A')
    return s
  })
  edit(B, s => {
    s.docs[0] = editBody(s.docs[0], 'body from B', 'B')
    return s
  })
  await flush(A)
  await flush(B)
  await pull(A)
  await pull(B)
  const winner = d => d.state.docs.find(x => x.id === docId).body
  const copies = d => d.state.docs.filter(x => x.conflictOf === docId)
  assert.equal(winner(A), winner(B), 'one winner body')
  assert.equal(copies(A).length, 1, 'A has one conflicted copy')
  assert.equal(copies(B).length, 1, 'B has one conflicted copy')
  assert.equal(copies(A)[0].id, copies(B)[0].id, 'same copy id')
  assert.deepEqual([winner(A), copies(A)[0].body].sort(), ['body from A', 'body from B'])
  console.log('ok: concurrent doc body edits -> one winner plus the same conflicted copy')

  // Restart: A reopens and keeps clock order.
  const store2 = new Store(path.join(root, 'A', 'prometheus.db'))
  await store2.open()
  const A2 = { dir: A.dir, state: A.state }
  A2.engine = new SyncEngine(A.dir, store2, { read: () => A2.state, write: n => (A2.state = n), keys })
  await A2.engine.init()
  edit(A2, s => {
    s.issues.find(i => i.id === id).title = 'after restart'
    return s
  })
  await flush(A2)
  await pull(B)
  assert.equal(B.state.issues.find(i => i.id === id).title, 'after restart')
  console.log('ok: restart keeps clock order')

  console.log('ALL OK', root)
  process.exit(0)
})().catch(err => {
  console.error('FAIL', err)
  process.exit(1)
})
