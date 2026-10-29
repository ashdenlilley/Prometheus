import { test, describe, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpController, type McpHost } from '../../src/main/mcp'
import { createIssue, reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData } from '../../src/shared/types'

const TOKEN = 'test-token'
const randomPort = () => 20000 + Math.floor(Math.random() * 20000)

interface Rpc {
  id?: unknown
  result?: any
  error?: { code: number; message: string }
}

function sampleData(): AppData {
  const data = emptyData()
  data.spaces.push({ id: 'space-1', name: 'Work', color: '#5e6ad2' })
  data.projects.push(blankProject({ id: 'proj-1', spaceId: 'space-1', name: 'Prometheus', key: 'PRM', color: '#5e6ad2' }))
  data.issues.push(createIssue(data, 'proj-1', 'Existing issue'))
  return data
}

function fakeHost() {
  const state = { data: sampleData() as AppData | null }
  const host: McpHost = {
    read: () => state.data,
    apply: a => {
      if (state.data) state.data = reducer(state.data, a)
    }
  }
  return { host, state }
}

function writeConfig(dir: string, port: number, token = TOKEN, enabled = true) {
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ enabled, token, port }))
}

// Auth header defaults to the valid token. Pass null to send no Authorization header.
async function post(port: number, body: unknown, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth !== null) headers.Authorization = auth
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(3000)
  })
  const text = await res.text()
  return { status: res.status, text, json: text ? (JSON.parse(text) as Rpc | Rpc[]) : undefined }
}

// node:http so the test can set Host and Origin explicitly.
function raw(port: number, headers: http.OutgoingHttpHeaders): Promise<{ status: number; json: Rpc | undefined }> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers }
      },
      res => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', c => (text += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : undefined }))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

const call = (name: string, args: Record<string, unknown> = {}, id = 1) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args }
})

// Parses the JSON text inside a tools/call result.
const toolJson = (reply: Rpc) => JSON.parse(reply.result.content[0].text)

describe('MCP HTTP layer', () => {
  let dir: string
  let port: number
  let ctrl: McpController
  let fake: ReturnType<typeof fakeHost>

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-http-'))
    port = randomPort()
    writeConfig(dir, port)
    fake = fakeHost()
    ctrl = new McpController(dir, fake.host)
    await ctrl.start()
  })

  after(async () => {
    await ctrl.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  beforeEach(() => {
    fake.state.data = sampleData()
  })

  describe('Host and Origin checks', () => {
    test('rejects a non-local Host header with 403 (DNS rebinding)', async () => {
      const res = await raw(port, { Host: 'evil.example' })
      assert.equal(res.status, 403)
      assert.equal(res.json?.error?.message, 'Forbidden host')
    })

    test('rejects a cross-site Origin with 403', async () => {
      const res = await raw(port, { Origin: 'https://evil.example' })
      assert.equal(res.status, 403)
      assert.equal(res.json?.error?.message, 'Forbidden origin')
    })

    test('accepts a localhost Origin', async () => {
      const res = await raw(port, { Origin: 'http://localhost:5173' })
      assert.equal(res.status, 200)
      assert.deepEqual(res.json?.result, {})
    })

    test('a wrong path returns 404 without auth', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/other`, { method: 'POST' })
      assert.equal(res.status, 404)
    })
  })

  describe('bearer token', () => {
    test('a missing Authorization header returns 401 with JSON-RPC error -32001', async () => {
      const res = await post(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, null)
      assert.equal(res.status, 401)
      assert.equal((res.json as Rpc).error?.code, -32001)
    })

    test('a wrong token returns 401', async () => {
      const res = await post(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, 'Bearer nope')
      assert.equal(res.status, 401)
    })

    test('a non-Bearer scheme with the right token returns 401', async () => {
      const res = await post(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, `Basic ${TOKEN}`)
      assert.equal(res.status, 401)
    })

    test('the right token gets through', async () => {
      const res = await post(port, { jsonrpc: '2.0', id: 1, method: 'ping' })
      assert.equal(res.status, 200)
    })
  })

  describe('request bodies', () => {
    test('a non-POST request returns 405 once authorised', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET', headers: { Authorization: `Bearer ${TOKEN}` } })
      assert.equal(res.status, 405)
    })

    test('invalid JSON returns 400 with a parse error', async () => {
      const res = await post(port, '{not json')
      assert.equal(res.status, 400)
      assert.equal((res.json as Rpc).error?.code, -32700)
    })

    test('a notification-only body returns 202 with no body', async () => {
      const res = await post(port, { jsonrpc: '2.0', method: 'notifications/initialized' })
      assert.equal(res.status, 202)
      assert.equal(res.text, '')
    })

    test('a batch returns an array of replies and skips notifications', async () => {
      const res = await post(port, [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 'two', method: 'ping' }
      ])
      assert.equal(res.status, 200)
      assert.ok(Array.isArray(res.json))
      const replies = res.json as Rpc[]
      assert.equal(replies.length, 2)
      assert.deepEqual(replies.map(r => r.id), [1, 'two'])
    })

    test('a batch of only notifications returns 202', async () => {
      const res = await post(port, [{ jsonrpc: '2.0', method: 'notifications/initialized' }])
      assert.equal(res.status, 202)
    })

    // JSON-RPC 2.0 says an empty batch is an Invalid Request (-32600) with a single error reply.
    test('an empty batch array returns an error reply', { todo: 'BUG: empty batch [] returns 202 instead of a -32600 error' }, async () => {
      const res = await post(port, [])
      assert.equal(res.status, 200)
      assert.equal((res.json as Rpc).error?.code, -32600)
    })

    // JSON null parses fine, then handle() reads msg.id on null and throws inside the async request handler.
    // Its own server is started here so the unhandled rejection is attributed to this test, not the shared before hook.
    test('a JSON null body gets an error reply', { skip: 'BUG: body "null" throws in handle() (unhandled rejection, no response); skipped rather than todo so the crash cannot leak into other tests' }, async () => {
      const dirNull = mkdtempSync(join(tmpdir(), 'mcp-null-'))
      const portNull = randomPort()
      writeConfig(dirNull, portNull)
      const server = new McpController(dirNull, fakeHost().host)
      await server.start()
      try {
        const res = await post(portNull, 'null')
        assert.equal(res.status, 400)
      } finally {
        await server.stop()
        rmSync(dirNull, { recursive: true, force: true })
      }
    })
  })

  describe('JSON-RPC methods', () => {
    test('initialize echoes a supported protocol version', async () => {
      const res = await post(port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
      assert.equal((res.json as Rpc).result.protocolVersion, '2025-03-26')
      assert.deepEqual((res.json as Rpc).result.capabilities, { tools: {} })
    })

    test('initialize falls back to the newest version for an unknown one', async () => {
      const res = await post(port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })
      assert.equal((res.json as Rpc).result.protocolVersion, '2025-06-18')
    })

    test('ping returns an empty result', async () => {
      const res = await post(port, { jsonrpc: '2.0', id: 7, method: 'ping' })
      assert.deepEqual(res.json, { jsonrpc: '2.0', id: 7, result: {} })
    })

    test('an unknown method returns -32601', async () => {
      const res = await post(port, { jsonrpc: '2.0', id: 3, method: 'resources/list' })
      assert.equal((res.json as Rpc).error?.code, -32601)
      assert.equal((res.json as Rpc).id, 3)
    })

    test('tools/call with an unknown tool returns -32602', async () => {
      const res = await post(port, call('no_such_tool'))
      assert.equal((res.json as Rpc).error?.code, -32602)
    })

    test('tools/call returns isError when host.read() is null', async () => {
      fake.state.data = null
      const res = await post(port, call('list_spaces'))
      assert.equal((res.json as Rpc).result.isError, true)
      assert.match((res.json as Rpc).result.content[0].text, /not loaded/)
    })

    test('a tool failure is an isError result, not a JSON-RPC error', async () => {
      const res = await post(port, call('get_issue', { key: 'PRM-999' }))
      assert.equal((res.json as Rpc).error, undefined)
      assert.equal((res.json as Rpc).result.isError, true)
      assert.match((res.json as Rpc).result.content[0].text, /Issue not found/)
    })

    test('tools/call create_issue writes through host.apply', async () => {
      const res = await post(port, call('create_issue', { projectId: 'PRM', title: 'From MCP' }))
      const issue = toolJson(res.json as Rpc)
      assert.equal(issue.key, 'PRM-2')
      assert.equal(fake.state.data?.issues.length, 2)
      assert.equal(fake.state.data?.issues[1].title, 'From MCP')
    })
  })
})

describe('McpController', () => {
  let dir: string
  let ctrl: McpController | undefined
  let blocker: http.Server | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-ctrl-'))
  })

  afterEach(async () => {
    await ctrl?.stop()
    ctrl = undefined
    if (blocker) await new Promise<void>(resolve => blocker!.close(() => resolve()))
    blocker = undefined
    rmSync(dir, { recursive: true, force: true })
  })

  test('creates mcp.json with a random token when the file is missing', async () => {
    ctrl = new McpController(dir, fakeHost().host)
    await ctrl.status()
    const cfg = JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'))
    assert.equal(cfg.enabled, true)
    assert.equal(cfg.port, 7878)
    assert.match(cfg.token, /^[0-9a-f]{48}$/)
  })

  test('status() reports the saved config before start and the live port after', async () => {
    const port = randomPort()
    writeConfig(dir, port)
    ctrl = new McpController(dir, fakeHost().host)

    const before = await ctrl.status()
    assert.deepEqual(before, { enabled: true, running: false, url: `http://127.0.0.1:${port}/mcp`, token: TOKEN, port })

    await ctrl.start()
    const after = await ctrl.status()
    assert.equal(after.running, true)
    assert.equal(after.port, port)
    assert.equal(after.url, `http://127.0.0.1:${port}/mcp`)
  })

  test('setEnabled(false) stops the server and persists enabled: false', async () => {
    const port = randomPort()
    writeConfig(dir, port)
    ctrl = new McpController(dir, fakeHost().host)
    await ctrl.start()

    const status = await ctrl.setEnabled(false)
    assert.equal(status.enabled, false)
    assert.equal(status.running, false)
    assert.equal(JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8')).enabled, false)
    await assert.rejects(fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST' }))
  })

  test('regenerateToken changes the token and the old one gets 401', async () => {
    const port = randomPort()
    writeConfig(dir, port)
    ctrl = new McpController(dir, fakeHost().host)
    await ctrl.start()

    const { token } = await ctrl.regenerateToken()
    assert.notEqual(token, TOKEN)
    assert.equal(JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8')).token, token)

    const stale = await post(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, `Bearer ${TOKEN}`)
    assert.equal(stale.status, 401)
    const fresh = await post(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, `Bearer ${token}`)
    assert.equal(fresh.status, 200)
  })

  test('start() moves to the next port when the configured one is busy', async () => {
    const port = randomPort()
    blocker = http.createServer()
    await new Promise<void>(resolve => blocker!.listen(port, '127.0.0.1', () => resolve()))
    writeConfig(dir, port)
    ctrl = new McpController(dir, fakeHost().host)
    await ctrl.start()

    const status = await ctrl.status()
    assert.equal(status.running, true)
    assert.equal(status.port, port + 1)
    assert.equal(status.url, `http://127.0.0.1:${port + 1}/mcp`)
  })
})
