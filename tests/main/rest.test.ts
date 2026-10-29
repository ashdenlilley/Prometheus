import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpController, type McpHost } from '../../src/main/mcp'
import { createIssue, reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData } from '../../src/shared/types'

const TOKEN = 'test-token-rest-0123456789'
const randomPort = () => 20000 + Math.floor(Math.random() * 20000)

// Project PRM with PRM-1 (todo, assigned to Sam, label auth) and PRM-2 (done).
function fixture(): AppData {
  const data = emptyData()
  data.spaces.push({ id: 'space-1', name: 'Prometheus', color: '#5e6ad2' })
  data.projects.push(blankProject({ id: 'proj-1', spaceId: 'space-1', name: 'Core app', key: 'PRM', color: '#5e6ad2' }))
  data.issues.push(createIssue(data, 'proj-1', 'Login fails', { status: 'todo', assignee: 'Sam', labels: ['auth'] }))
  data.issues.push(createIssue(data, 'proj-1', 'Ship release', { status: 'done' }))
  return data
}

function fakeHost() {
  const state = { data: fixture() as AppData | null }
  const host: McpHost = {
    read: () => state.data,
    apply: a => {
      if (state.data) state.data = reducer(state.data, a)
    }
  }
  return { host, state }
}

interface Reply {
  status: number
  json: any
}

async function api(port: number, method: string, path: string, body?: unknown, auth: string | null = `Bearer ${TOKEN}`): Promise<Reply> {
  const headers: Record<string, string> = {}
  if (auth !== null) headers.Authorization = auth
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(3000)
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : undefined }
}

// node:http so the test can set the Host header.
function withHost(port: number, host: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/v1/projects', method: 'GET', agent: false, headers: { Host: host, Authorization: `Bearer ${TOKEN}` } },
      res => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', c => (text += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : undefined }))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

describe('REST API /api/v1', () => {
  let dir: string
  let port: number
  let ctrl: McpController
  let fake: ReturnType<typeof fakeHost>

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'rest-'))
    port = randomPort()
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ enabled: true, token: TOKEN, port }))
    fake = fakeHost()
    ctrl = new McpController(dir, fake.host)
    await ctrl.start()
  })

  after(async () => {
    await ctrl.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  beforeEach(() => {
    fake.state.data = fixture()
  })

  test('401 without the bearer token, in the error format', async () => {
    const res = await api(port, 'GET', '/api/v1/projects', undefined, null)
    assert.equal(res.status, 401)
    assert.equal(res.json.error.code, 'unauthorized')
    const wrong = await api(port, 'GET', '/api/v1/projects', undefined, 'Bearer nope')
    assert.equal(wrong.status, 401)
  })

  test('403 for a non-local Host header', async () => {
    const res = await withHost(port, 'evil.example')
    assert.equal(res.status, 403)
  })

  test('GET /projects lists projects with issue counts', async () => {
    const res = await api(port, 'GET', '/api/v1/projects')
    assert.equal(res.status, 200)
    assert.equal(res.json[0].key, 'PRM')
    assert.equal(res.json[0].issues, 2)
    assert.equal(res.json[0].done, 1)
  })

  test('GET /issues lists all issues, and filters by project, status, assignee and q', async () => {
    const all = await api(port, 'GET', '/api/v1/issues')
    assert.equal(all.json.length, 2)

    const done = await api(port, 'GET', '/api/v1/issues?project=PRM&status=done')
    assert.deepEqual(
      done.json.map((i: { key: string }) => i.key),
      ['PRM-2']
    )

    const sam = await api(port, 'GET', '/api/v1/issues?assignee=sam')
    assert.deepEqual(
      sam.json.map((i: { key: string }) => i.key),
      ['PRM-1']
    )

    const q = await api(port, 'GET', '/api/v1/issues?q=auth')
    assert.deepEqual(
      q.json.map((i: { key: string }) => i.key),
      ['PRM-1']
    )

    const missing = await api(port, 'GET', '/api/v1/issues?project=NOPE')
    assert.equal(missing.status, 404)
  })

  test('GET /issues/:key returns one issue, 404 when unknown', async () => {
    const res = await api(port, 'GET', '/api/v1/issues/PRM-1')
    assert.equal(res.status, 200)
    assert.equal(res.json.title, 'Login fails')
    assert.equal(res.json.assignee, 'Sam')

    const unknown = await api(port, 'GET', '/api/v1/issues/PRM-99')
    assert.equal(unknown.status, 404)
    assert.equal(unknown.json.error.code, 'not_found')
  })

  test('POST /issues creates an issue (201), and rejects a missing title (400)', async () => {
    const res = await api(port, 'POST', '/api/v1/issues', { projectId: 'PRM', title: 'From REST', priority: 2 })
    assert.equal(res.status, 201)
    assert.equal(res.json.key, 'PRM-3')
    assert.equal(fake.state.data!.issues.length, 3)

    const bad = await api(port, 'POST', '/api/v1/issues', { projectId: 'PRM' })
    assert.equal(bad.status, 400)
    assert.equal(bad.json.error.code, 'invalid_request')
  })

  test('PATCH /issues/:key changes the status and fields', async () => {
    const res = await api(port, 'PATCH', '/api/v1/issues/PRM-1', { status: 'done', title: 'Login fixed' })
    assert.equal(res.status, 200)
    assert.equal(res.json.status, 'done')
    assert.equal(res.json.title, 'Login fixed')
    assert.equal(fake.state.data!.issues.find(i => i.title === 'Login fixed')?.status, 'done')

    const badStatus = await api(port, 'PATCH', '/api/v1/issues/PRM-1', { status: 'nope' })
    assert.equal(badStatus.status, 400)

    const unknown = await api(port, 'PATCH', '/api/v1/issues/PRM-99', { status: 'done' })
    assert.equal(unknown.status, 404)
  })

  test('PATCH uses the key in the path even if the body names another issue', async () => {
    const res = await api(port, 'PATCH', '/api/v1/issues/PRM-2', { key: 'PRM-1', title: 'Shipped' })
    assert.equal(res.json.key, 'PRM-2')
    assert.equal(fake.state.data!.issues.find(i => i.number === 1)?.title, 'Login fails')
  })

  test('POST /issues/:key/comments adds a comment (201)', async () => {
    const res = await api(port, 'POST', '/api/v1/issues/PRM-1/comments', { body: 'Repro in staging', author: 'Sam' })
    assert.equal(res.status, 201)
    assert.equal(res.json.key, 'PRM-1')
    assert.equal(res.json.author, 'Sam')
    const comments = fake.state.data!.issues.find(i => i.number === 1)!.comments
    assert.equal(comments.at(-1)?.body, 'Repro in staging')

    const missingBody = await api(port, 'POST', '/api/v1/issues/PRM-1/comments', {})
    assert.equal(missingBody.status, 400)
  })

  test('DELETE is refused with 405', async () => {
    const res = await api(port, 'DELETE', '/api/v1/issues/PRM-1')
    assert.equal(res.status, 405)
    assert.equal(res.json.error.code, 'method_not_allowed')
    assert.equal(fake.state.data!.issues.length, 2)
  })

  test('400 for a body that is not a JSON object', async () => {
    const bad = await api(port, 'POST', '/api/v1/issues', '{not json')
    assert.equal(bad.status, 400)
    assert.equal(bad.json.error.code, 'invalid_json')

    const array = await api(port, 'POST', '/api/v1/issues', [1, 2])
    assert.equal(array.status, 400)
  })

  test('413 for a body over the size limit', async () => {
    const res = await api(port, 'POST', '/api/v1/issues', JSON.stringify({ title: 'x'.repeat(1024 * 1024 + 10) }))
    assert.equal(res.status, 413)
    assert.equal(res.json.error.code, 'payload_too_large')
  })

  test('404 for an unknown route', async () => {
    const res = await api(port, 'GET', '/api/v1/nope')
    assert.equal(res.status, 404)
    assert.equal(res.json.error.code, 'not_found')
  })

  test('MCP is unaffected: /mcp still answers JSON-RPC', async () => {
    const res = await api(port, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' })
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, { jsonrpc: '2.0', id: 1, result: {} })
  })
})
