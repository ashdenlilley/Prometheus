import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpController, hashToken, type McpHost, type McpKeys } from '../../src/main/mcp'
import { reducer, createIssue, type Action } from '../../src/shared/model'
import { agentAssignee, stampActor } from '../../src/shared/agents'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData } from '../../src/shared/types'

const TOKEN = 'test-token-0123456789abcdef'

interface ToolResult {
  isError?: boolean
  content: { type: string; text: string }[]
}

const dir = mkdtempSync(join(tmpdir(), 'mcp-agents-'))
const port = 20000 + Math.floor(Math.random() * 20000)
const url = `http://127.0.0.1:${port}/mcp`

let data: AppData
// Every apply from MCP, with the actor it was given. Shows which calls were attributed.
let applied: { type: string; actor?: string }[] = []

// Mirrors the app's host: stamps activity with the actor before the change is stored.
const host: McpHost = {
  read: () => data,
  apply: (a: Action, actor?: string) => {
    applied.push({ type: a.type, actor })
    const prev = data
    data = stampActor(prev, reducer(prev, a), actor ?? 'agent:legacy')
  }
}

// Agents are created through the controller so the tests use the real token format and hashing.
const mcp = new McpController(dir, host)
const alpha = mcp.createAgent('Alpha', '#111111', 'comment')
const beta = mcp.createAgent('Beta', '#222222', 'write')
const reader = mcp.createAgent('Reader', '#333333', 'read')
const gone = mcp.createAgent('Gone', '#444444', 'write')
const spammer = mcp.createAgent('Spammer', '#555555', 'write')
const revokedAt = '2026-10-02T00:00:00.000Z'

// Fixture: PRM-1 assigned to Alpha (todo), PRM-2 assigned to Beta (in progress), PRM-3 assigned to Gone.
function fixture(): AppData {
  const base: AppData = {
    ...emptyData(),
    spaces: [{ id: 'space-1', name: 'Prometheus', color: '#5e6ad2' }],
    projects: [blankProject({ id: 'proj-1', spaceId: 'space-1', name: 'Core app', key: 'PRM', color: '#5e6ad2' })],
    agents: [alpha.agent, beta.agent, reader.agent, { ...gone.agent, revokedAt }, spammer.agent]
  }
  const first = createIssue(base, 'proj-1', 'Fix login bug', { status: 'todo', assignee: agentAssignee(alpha.agent.id) })
  const second = createIssue({ ...base, issues: [first] }, 'proj-1', 'Write docs', {
    status: 'in_progress',
    assignee: agentAssignee(beta.agent.id)
  })
  const third = createIssue({ ...base, issues: [first, second] }, 'proj-1', 'Old task', { assignee: agentAssignee(gone.agent.id) })
  return { ...base, issues: [first, second, third] }
}

// Calls the endpoint with a given bearer token. The shared token is the default.
async function rpc(method: string, params: Record<string, unknown> = {}, token = TOKEN) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
  return { status: res.status, body: (await res.json().catch(() => undefined)) as { result?: any; error?: unknown } | undefined }
}

async function call(token: string, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const reply = await rpc('tools/call', { name, arguments: args }, token)
  assert.equal(reply.body?.error, undefined, `tools/call ${name} returned a JSON-RPC error`)
  return reply.body?.result as ToolResult
}

async function ok(token: string, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const r = await call(token, name, args)
  assert.notEqual(r.isError, true, `${name} failed: ${r.content[0].text}`)
  return JSON.parse(r.content[0].text)
}

async function refused(token: string, name: string, args: Record<string, unknown>, message: RegExp) {
  const r = await call(token, name, args)
  assert.equal(r.isError, true, `${name} should be refused`)
  assert.match(r.content[0].text, message)
}

before(async () => {
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ enabled: true, token: TOKEN, port }))
  data = fixture()
  await mcp.start()
})

after(async () => {
  await mcp.stop()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  data = fixture()
  applied = []
})

describe('agent tokens', () => {
  test('createAgent returns a prefixed token whose hash is stored, and applies nothing', () => {
    assert.match(alpha.token, /^prm_[A-Za-z0-9_-]{43}$/)
    assert.equal(alpha.agent.tokenHash, hashToken(alpha.token))
    assert.equal(alpha.agent.tokenHash.length, 64)
    assert.equal(alpha.agent.tokenHash.includes(alpha.token), false)
  })
})

describe('my_issues and whoami', () => {
  test('each agent sees only the open issues assigned to it', async () => {
    const mine = await ok(alpha.token, 'my_issues')
    assert.deepEqual(mine.map((i: { key: string }) => i.key), ['PRM-1'])
    const theirs = await ok(beta.token, 'my_issues')
    assert.deepEqual(theirs.map((i: { key: string }) => i.key), ['PRM-2'])
  })

  test('my_issues uses the list_issues shape and hides done issues unless asked', async () => {
    data = reducer(data, { type: 'patchIssue', id: data.issues[0].id, patch: { status: 'done' } })
    assert.deepEqual(await ok(alpha.token, 'my_issues'), [])
    const all = await ok(alpha.token, 'my_issues', { includeDone: true })
    assert.equal(all.length, 1)
    assert.ok('category' in all[0] && 'key' in all[0] && 'status' in all[0])
  })

  test('whoami reports the calling agent', async () => {
    assert.deepEqual(await ok(beta.token, 'whoami'), {
      id: beta.agent.id,
      name: 'Beta',
      level: 'write',
      assignee: `agent:${beta.agent.id}`
    })
  })

  test('the shared token is the legacy agent and sees its own assignments', async () => {
    assert.deepEqual(await ok(TOKEN, 'whoami'), { id: 'legacy', name: 'Unnamed agent', level: 'write', assignee: 'agent:legacy' })
    assert.deepEqual(await ok(TOKEN, 'my_issues'), [])
  })
})

describe('authentication', () => {
  test('a revoked agent token gets 401', async () => {
    const reply = await rpc('tools/list', {}, gone.token)
    assert.equal(reply.status, 401)
  })

  test('an unknown token gets 401', async () => {
    const reply = await rpc('tools/list', {}, 'prm_not-a-real-token')
    assert.equal(reply.status, 401)
  })

  test('a live agent token is accepted', async () => {
    const reply = await rpc('tools/list', {}, alpha.token)
    assert.equal(reply.status, 200)
  })
})

describe('levels', () => {
  test('read level may run queries but not create_issue', async () => {
    await refused(reader.token, 'create_issue', { projectId: 'PRM', title: 'Nope' }, /Reader \(level read\) may not call create_issue/)
    assert.equal(data.issues.length, 3)
    assert.equal((await ok(reader.token, 'list_issues')).length, 3)
  })

  test('comment level can add a comment, which is authored by the agent', async () => {
    const c = await ok(alpha.token, 'add_comment', { key: 'PRM-2', body: 'Looks fine', author: 'Ashden' })
    assert.equal(c.author, 'Alpha')
    assert.equal(data.issues[1].comments.at(-1)?.author, 'Alpha')
  })

  test('comment level can change status on its own issue', async () => {
    const issue = await ok(alpha.token, 'update_issue', { key: 'PRM-1', status: 'in_progress' })
    assert.equal(issue.status, 'in_progress')
  })

  test('comment level cannot change status on another agent\'s issue', async () => {
    await refused(alpha.token, 'update_issue', { key: 'PRM-2', status: 'done' }, /Alpha \(level comment\) may not call update_issue/)
    assert.equal(data.issues[1].status, 'in_progress')
  })

  test('comment level cannot change anything besides status', async () => {
    await refused(alpha.token, 'update_issue', { key: 'PRM-1', title: 'Renamed', status: 'done' }, /may not call update_issue/)
    assert.equal(data.issues[0].title, 'Fix login bug')
  })

  test('the confirm argument is dropped for normal tools', async () => {
    const created = await ok(beta.token, 'create_issue', { projectId: 'PRM', title: 'Confirmed', confirm: true })
    assert.equal(created.key, 'PRM-4')
  })

  test('the shared token still runs every tool as the Unnamed agent', async () => {
    await ok(TOKEN, 'create_issue', { projectId: 'PRM', title: 'From the shared token' })
    assert.equal(applied.at(-1)?.actor, 'agent:legacy')
  })
})

describe('attribution', () => {
  test('writes made with an agent token are recorded with that agent as actor', async () => {
    await ok(beta.token, 'update_issue', { key: 'PRM-2', status: 'done' })
    assert.equal(applied.at(-1)?.actor, `agent:${beta.agent.id}`)
    const activity = data.issues[1].activity
    assert.equal(activity.at(-1)?.actor, `agent:${beta.agent.id}`)
  })

  test('add_comment through an agent is attributed too', async () => {
    await ok(alpha.token, 'add_comment', { key: 'PRM-1', body: 'Working on it' })
    assert.equal(applied.at(-1)?.actor, `agent:${alpha.agent.id}`)
  })
})

describe('rate limit', () => {
  test('61st write is refused, and one notification is raised for the run', async () => {
    for (let n = 0; n < 60; n++) {
      await ok(spammer.token, 'create_issue', { projectId: 'PRM', title: `Spam ${n}` })
    }
    await refused(spammer.token, 'create_issue', { projectId: 'PRM', title: 'Too many' }, /^Rate limit: 60 writes a minute$/)
    await refused(spammer.token, 'create_issue', { projectId: 'PRM', title: 'Still too many' }, /^Rate limit: 60 writes a minute$/)
    const alerts = data.notifications.filter(n => n.text === 'Spammer hit the write rate limit')
    assert.equal(alerts.length, 1)
  })

  test('reads are not limited', async () => {
    for (let n = 0; n < 65; n++) await ok(spammer.token, 'list_issues')
  })
})

describe('deletes and agent management', () => {
  test('no tool can change agents, settings or sync', async () => {
    const reply = await rpc('tools/list')
    const names: string[] = (reply.body?.result?.tools ?? []).map((t: { name: string }) => t.name)
    assert.equal(names.some(n => /agent|setting|sync/i.test(n)), false)
  })
})

describe('plaintext token migration', () => {
  test('a plaintext token in mcp.json is sealed when keys are passed, and keeps working', async () => {
    const d = mkdtempSync(join(tmpdir(), 'mcp-seal-'))
    try {
      writeFileSync(join(d, 'mcp.json'), JSON.stringify({ enabled: true, token: 'plain-token', port: 1 }))
      const keys: McpKeys = {
        seal: async s => `sealed:${Buffer.from(s).toString('base64')}`,
        open: async s => (s.startsWith('sealed:') ? Buffer.from(s.slice(7), 'base64').toString() : null)
      }
      const sealed = new McpController(d, host, keys)
      assert.equal((await sealed.status()).token, 'plain-token')
      const onDisk = JSON.parse(readFileSync(join(d, 'mcp.json'), 'utf8'))
      assert.equal(onDisk.token, undefined)
      assert.equal(onDisk.sealedToken, 'sealed:' + Buffer.from('plain-token').toString('base64'))
      assert.equal((await new McpController(d, host, keys).status()).token, 'plain-token')
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
