// Two real CloudSync clients (src/main/cloud.ts, bundled here) against the Worker in Miniflare on 127.0.0.1.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { Miniflare } from 'miniflare'
import { JWT_SECRET, OWNER } from './helpers.mjs'

const repo = fileURLToPath(new URL('../../', import.meta.url))

// Bundles the client and the pure sync helpers it needs into one temp .mjs. Electron is not involved.
async function bundleClient() {
  const dir = mkdtempSync(join(tmpdir(), 'client-bundle-'))
  const outfile = join(dir, 'client.mjs')
  const contents = [
    `export * from ${JSON.stringify(join(repo, 'src/main/cloud.ts'))}`,
    `export { Clock, diffOps, stampOps } from ${JSON.stringify(join(repo, 'src/shared/sync.ts'))}`,
    `export { emptyData } from ${JSON.stringify(join(repo, 'src/shared/seed.ts'))}`
  ].join('\n')
  await esbuild.build({ stdin: { contents, resolveDir: repo, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', target: 'node22', outfile, logLevel: 'silent' })
  return { dir, mod: await import(pathToFileURL(outfile).href) }
}

// Same bindings as helpers.mjs, but on a random loopback port, so the clients use real sockets.
async function startServer() {
  const emails = []
  const mf = new Miniflare({
    modules: true,
    scriptPath: new URL('../dist/worker.js', import.meta.url).pathname,
    compatibilityDate: '2026-08-01',
    durableObjects: {
      AUTH: { className: 'Auth', useSQLite: true },
      WORKSPACE: { className: 'Workspace', useSQLite: true }
    },
    bindings: {
      OWNER_EMAIL: OWNER,
      JWT_SECRET,
      PUBLIC_URL: 'https://sync.test',
      EMAIL_API_KEY: 'test-email-key',
      EMAIL_FROM: 'Prometheus <signin@example.com>',
      EMAIL_PROVIDER: 'resend',
      COMPACT_AT: '10000',
      COMPACT_KEEP: '2000'
    },
    // Captures the sign-in email instead of sending it.
    outboundService: async req => {
      emails.push({ body: await req.json() })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    },
    host: '127.0.0.1',
    port: 0
  })
  const url = (await mf.ready).origin
  return { mf, emails, url }
}

const lastToken = server => new URL(/https?:\/\/\S+/.exec(server.emails.at(-1).body.text)[0]).searchParams.get('t')

async function until(pred, ms = 5000) {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise(r => setTimeout(r, 10))
  }
}

// One device: its own temp dir, an in-memory store and credentials, and a WebSocket we can cut off.
function makeDevice(mod, name) {
  const dir = mkdtempSync(join(tmpdir(), `device-${name}-`))
  const creds = new Map()
  const dev = { name, dir, creds, state: { data: mod.emptyData() }, writes: [], sockets: new Set(), online: true, clock: new mod.Clock(name), clocks: new Map() }
  dev.cloud = new mod.CloudSync({
    dir,
    store: {
      async setClocks() {},
      async clearClocks() {}
    },
    clock: dev.clock,
    clocks: dev.clocks,
    credentials: {
      async get(n) {
        return creds.get(n) ?? null
      },
      async set(n, v) {
        creds.set(n, v)
      },
      async delete(n) {
        creds.delete(n)
      }
    },
    hooks: {
      read: () => dev.state.data,
      write: next => {
        dev.state.data = next
        dev.writes.push(next)
      }
    },
    // While offline, a socket closes at once, so the client keeps retrying until the device is back online.
    WebSocket: function (url, protocols) {
      const ws = new WebSocket(url, protocols)
      dev.sockets.add(ws)
      ws.addEventListener('close', () => dev.sockets.delete(ws))
      if (!dev.online) ws.close()
      return ws
    },
    pollMs: 20,
    pingMs: 60_000,
    minRetryMs: 20,
    maxRetryMs: 200
  })
  return dev
}

// Applies a local change the way the app does: diff, stamp the clocks, then queue it for sync.
function edit(mod, dev, change) {
  const prev = dev.state.data
  const next = change(prev)
  const ops = mod.diffOps(prev, next, dev.clock)
  mod.stampOps(dev.clocks, ops)
  dev.state.data = next
  dev.cloud.record(ops)
}

async function signIn(server, dev) {
  const before = server.emails.length
  await dev.cloud.startSignIn(server.url, OWNER, dev.name)
  await until(() => server.emails.length > before)
  // The confirm button's POST, with the token from the emailed link.
  const res = await fetch(`${server.url}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ t: lastToken(server) })
  })
  assert.equal(res.status, 200)
  await until(() => dev.cloud.getStatus().enabled)
}

const issue = (id, title) => ({ id, title, projectId: '', number: 1, createdAt: new Date().toISOString() })

test('two devices: merge, adopt, live edits, offline catch-up in order, and revoke', async () => {
  const { dir: bundleDir, mod } = await bundleClient()
  const server = await startServer()
  const a = makeDevice(mod, 'laptop')
  const b = makeDevice(mod, 'phone')
  try {
    // A: the server is empty, so A merges and connects without a choice.
    await signIn(server, a)
    await until(() => a.cloud.getStatus().state === 'connected')
    assert.equal(a.cloud.getStatus().needsJoin, false)
    edit(mod, a, d => ({ ...d, issues: [issue('i1', 'First')] }))
    await until(() => a.cloud.getStatus().pending === 0)

    // B: the server has data, so B must choose. Adopt takes the server's copy.
    await signIn(server, b)
    await until(() => b.cloud.getStatus().needsJoin)
    await b.cloud.join('adopt')
    await until(() => b.state.data.issues.some(i => i.id === 'i1'))
    assert.equal(b.state.data.issues[0].title, 'First')

    // Live edits both ways.
    edit(mod, b, d => ({ ...d, issues: d.issues.map(i => (i.id === 'i1' ? { ...i, title: 'Edited by phone' } : i)) }))
    await until(() => a.state.data.issues[0].title === 'Edited by phone')

    // A goes offline and edits twice, then reconnects. B must receive both, in order.
    a.online = false
    for (const ws of a.sockets) ws.close()
    await until(() => a.sockets.size === 0)
    edit(mod, a, d => ({ ...d, issues: d.issues.map(i => ({ ...i, title: 'Offline 1' })) }))
    edit(mod, a, d => ({ ...d, issues: d.issues.map(i => ({ ...i, title: 'Offline 2' })) }))
    assert.equal(a.cloud.getStatus().pending, 2)
    a.online = true
    await until(() => b.state.data.issues[0].title === 'Offline 2')
    const seen = b.writes.map(w => w.issues[0]?.title).filter(t => t?.startsWith('Offline'))
    const first = seen.indexOf('Offline 1')
    assert.ok(first === -1 || first < seen.indexOf('Offline 2'), `order was ${seen.join(', ')}`)
    await until(() => a.cloud.getStatus().pending === 0)

    // A revokes B. B is signed out when its socket closes, and keeps its local data.
    await a.cloud.revokeDevice(b.cloud.getStatus().deviceId)
    await until(() => !b.cloud.getStatus().enabled)
    assert.match(b.cloud.getStatus().error, /signed out/)
    assert.equal(b.creds.has('cloud.refreshToken'), false)
    assert.equal(b.state.data.issues[0].title, 'Offline 2')
  } finally {
    a.cloud.stop()
    b.cloud.stop()
    await server.mf.dispose()
    rmSync(bundleDir, { recursive: true, force: true })
  }
})
