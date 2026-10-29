import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpController, type McpHost } from '../../src/main/mcp'
import { reducer, createIssue, type Action } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData } from '../../src/shared/types'

const TOKEN = 'test-token-0123456789abcdef'

interface ToolResult {
  isError?: boolean
  content: { type: string; text: string }[]
}

interface Reply {
  jsonrpc: string
  id: number | string | null
  result?: ToolResult & { tools?: { name: string; description: string; inputSchema: Record<string, unknown> }[] }
  error?: { code: number; message: string }
}

// Fixture: one space, one project PRM with two issues (PRM-1 todo + label "auth", PRM-2 done).
function fixture(): AppData {
  const base: AppData = {
    ...emptyData(),
    spaces: [{ id: 'space-1', name: 'Prometheus', color: '#5e6ad2' }],
    projects: [blankProject({ id: 'proj-1', spaceId: 'space-1', name: 'Core app', key: 'PRM', color: '#5e6ad2', status: 'in_progress' })]
  }
  const first = createIssue(base, 'proj-1', 'Fix login bug', { status: 'todo', labels: ['auth'] })
  const second = createIssue({ ...base, issues: [first] }, 'proj-1', 'Write docs', { status: 'done' })
  return { ...base, issues: [first, second] }
}

let data: AppData
const host: McpHost = {
  read: () => data,
  apply: (a: Action) => {
    data = reducer(data, a)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'mcp-tools-'))
const port = 20000 + Math.floor(Math.random() * 20000)
const mcp = new McpController(dir, host)
const url = `http://127.0.0.1:${port}/mcp`

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<Reply> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
  return (await res.json()) as Reply
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const reply = await rpc('tools/call', { name, arguments: args })
  assert.equal(reply.error, undefined, `tools/call ${name} returned a JSON-RPC error`)
  return reply.result as ToolResult
}

// Parses a successful tool result; fails the test if the tool reported an error.
async function ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const r = await call(name, args)
  assert.notEqual(r.isError, true, `${name} failed: ${r.content[0].text}`)
  return JSON.parse(r.content[0].text)
}

// Asserts an isError result with the given message and returns the text.
async function fails(name: string, args: Record<string, unknown>, message: RegExp): Promise<string> {
  const r = await call(name, args)
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, message)
  return r.content[0].text
}

before(async () => {
  data = fixture()
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ enabled: true, token: TOKEN, port }))
  await mcp.start()
})

after(async () => {
  await mcp.stop()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  data = fixture()
})

describe('tools/list', () => {
  test('every tool has a name, description and object inputSchema, with unique names', async () => {
    const reply = await rpc('tools/list')
    const tools = reply.result?.tools ?? []
    assert.ok(tools.length >= 15)
    for (const t of tools) {
      assert.equal(typeof t.name, 'string')
      assert.ok(t.name.length > 0)
      assert.equal(typeof t.description, 'string')
      assert.ok(t.description.length > 0, `${t.name} has no description`)
      assert.equal(t.inputSchema.type, 'object', `${t.name} inputSchema is not an object schema`)
    }
    assert.equal(new Set(tools.map(t => t.name)).size, tools.length)
  })

  test('lists the issue, project and relation tools by name', async () => {
    const names = ((await rpc('tools/list')).result?.tools ?? []).map(t => t.name)
    for (const n of ['get_issue', 'list_issues', 'create_issue', 'update_issue', 'add_comment', 'add_relation', 'get_project', 'update_project']) {
      assert.ok(names.includes(n), `missing ${n}`)
    }
  })
})

describe('read tools', () => {
  test('list_spaces reports each space with its project count', async () => {
    assert.deepEqual(await ok('list_spaces'), [{ id: 'space-1', name: 'Prometheus', projects: 1 }])
  })

  test('list_projects filters by spaceId', async () => {
    const all = await ok('list_projects')
    assert.equal(all.length, 1)
    assert.equal(all[0].key, 'PRM')
    assert.equal(all[0].issues, 2)
    assert.equal(all[0].done, 1)
    assert.deepEqual(await ok('list_projects', { spaceId: 'no-such-space' }), [])
  })

  test('get_project returns statuses and progress', async () => {
    const p = await ok('get_project', { projectId: 'PRM' })
    assert.equal(p.id, 'proj-1')
    assert.deepEqual(p.statuses.map((s: { id: string }) => s.id), ['backlog', 'todo', 'in_progress', 'done', 'canceled'])
    assert.deepEqual(p.progress, { done: 1, total: 2 })
  })

  test('list_issues filters by status and matches search against labels', async () => {
    const todo = await ok('list_issues', { status: 'todo' })
    assert.deepEqual(todo.map((i: { key: string }) => i.key), ['PRM-1'])
    const byLabel = await ok('list_issues', { search: 'AUTH' })
    assert.deepEqual(byLabel.map((i: { key: string }) => i.key), ['PRM-1'])
    assert.equal((await ok('list_issues', { limit: 1 })).length, 1)
  })

  test('get_issue resolves a key case-insensitively and returns the category', async () => {
    const i = await ok('get_issue', { key: 'prm-2' })
    assert.equal(i.key, 'PRM-2')
    assert.equal(i.title, 'Write docs')
    assert.equal(i.category, 'completed')
  })

  test('list_notifications returns only unread notifications with the issue key', async () => {
    data = { ...data, notifications: [
      { id: 'n1', at: '2026-01-01T00:00:00.000Z', text: 'read one', issueId: data.issues[0].id, read: true },
      { id: 'n2', at: '2026-01-02T00:00:00.000Z', text: 'unread one', issueId: data.issues[1].id, read: false }
    ] }
    const list = await ok('list_notifications')
    assert.equal(list.length, 1)
    assert.equal(list[0].id, 'n2')
    assert.equal(list[0].key, 'PRM-2')
  })
})

describe('write tools change host data', () => {
  test('create_issue adds the next number, defaults to the first status and is visible to list_issues', async () => {
    const created = await ok('create_issue', { projectId: 'PRM', title: '  New thing  ', priority: 2 })
    assert.equal(created.key, 'PRM-3')
    assert.equal(created.status, 'backlog')
    assert.equal(created.priority, 2)
    assert.equal(data.issues.length, 3)
    assert.equal(data.issues[2].title, 'New thing')
    assert.equal((await ok('list_issues', { search: 'new thing' })).length, 1)
  })

  test('create_issue with parentKey creates a sub-issue listed under its parent', async () => {
    const sub = await ok('create_issue', { projectId: 'proj-1', title: 'Child', parentKey: 'PRM-1' })
    assert.equal(sub.parentId, data.issues[0].id)
    const children = await ok('list_issues', { parentKey: 'PRM-1' })
    assert.deepEqual(children.map((i: { key: string }) => i.key), ['PRM-3'])
  })

  test('update_issue changes status and title on the host', async () => {
    await ok('update_issue', { key: 'PRM-1', status: 'in_progress', title: 'Fix login' })
    assert.equal(data.issues[0].status, 'in_progress')
    assert.equal(data.issues[0].title, 'Fix login')
  })

  test('update_issue replies with the updated issue', async () => {
    const updated = await ok('update_issue', { key: 'PRM-1', status: 'in_progress', title: 'Fix login' })
    assert.equal(updated.status, 'in_progress')
    assert.equal(updated.title, 'Fix login')
  })

  test('update_issue with an empty string clears the due date', async () => {
    await ok('update_issue', { id: data.issues[0].id, dueDate: '2026-12-01' })
    assert.equal(data.issues[0].dueDate, '2026-12-01')
    await ok('update_issue', { id: data.issues[0].id, dueDate: '' })
    assert.equal(data.issues[0].dueDate, undefined)
  })

  test('add_comment appends a comment authored by the local user by default', async () => {
    const c = await ok('add_comment', { key: 'PRM-1', body: 'Looks good' })
    assert.equal(c.author, 'You')
    assert.equal(data.issues[0].comments.length, 1)
    assert.equal(data.issues[0].comments[0].body, 'Looks good')
  })

  test('add_comment with an @mention of the local user raises a notification', async () => {
    await ok('add_comment', { key: 'PRM-1', body: 'ping @You please', author: 'Ada' })
    const notes = data.notifications
    assert.equal(notes.length, 1)
    assert.equal(notes[0].issueId, data.issues[0].id)
    assert.equal(notes[0].read, false)
  })

  test('add_relation stores a blocks relation that get_issue reports by key', async () => {
    await ok('add_relation', { key: 'PRM-1', type: 'blocks', targetKey: 'PRM-2' })
    assert.deepEqual(data.issues[0].relations, [{ type: 'blocks', targetId: data.issues[1].id }])
    const i = await ok('get_issue', { key: 'PRM-1' })
    assert.deepEqual(i.relations, [{ type: 'blocks', key: 'PRM-2' }])
  })

  test('set_issue_value stores a custom column value without dropping existing values', async () => {
    data = { ...data, issues: [{ ...data.issues[0], values: { est: 3 } }, data.issues[1]] }
    await ok('set_issue_value', { key: 'PRM-1', columnId: 'col-2', value: 'yes' })
    assert.deepEqual(data.issues[0].values, { est: 3, 'col-2': 'yes' })
  })

  test('create_cycle, create_project and update_project each change host data', async () => {
    await ok('create_cycle', { projectId: 'PRM', name: 'Sprint 1', startDate: '2026-11-01', endDate: '2026-11-14' })
    assert.equal(data.cycles.length, 1)
    assert.equal(data.cycles[0].name, 'Sprint 1')

    const proj = await ok('create_project', { spaceId: 'space-1', name: 'Mobile Shell' })
    assert.equal(proj.key, 'MOB')
    assert.equal(data.projects.length, 2)

    await ok('update_project', { projectId: 'PRM', status: 'paused', lead: 'Grace' })
    const prm = data.projects.find(p => p.id === 'proj-1')
    assert.equal(prm?.status, 'paused')
    assert.equal(prm?.lead, 'Grace')
  })
})

describe('error paths return isError results', () => {
  test('missing required arguments are reported, not thrown', async () => {
    await fails('create_issue', { projectId: 'PRM' }, /title is required/)
    await fails('add_comment', { key: 'PRM-1' }, /body is required/)
    await fails('create_space', {}, /name is required/)
    await fails('create_cycle', { projectId: 'PRM', name: 'x', startDate: '2026-11-01' }, /endDate is required/)
    assert.equal(data.issues.length, 2)
    assert.equal(data.issues[0].comments.length, 0)
  })

  test('unknown issue id or key is reported', async () => {
    await fails('get_issue', { id: 'missing' }, /Issue not found/)
    await fails('update_issue', { key: 'PRM-999', title: 'x' }, /Issue not found/)
    assert.equal(data.issues[0].title, 'Fix login bug')
  })

  test('unknown project is reported', async () => {
    await fails('get_project', { projectId: 'NOPE' }, /Project not found/)
    await fails('create_issue', { projectId: 'NOPE', title: 'x' }, /Project not found/)
    assert.equal(data.issues.length, 2)
  })

  test('invalid status on create_issue and update_issue is rejected without changing data', async () => {
    await fails('create_issue', { projectId: 'PRM', title: 'x', status: 'bogus' }, /status must be one of: backlog, todo/)
    await fails('update_issue', { key: 'PRM-1', status: 'bogus' }, /status must be one of/)
    assert.equal(data.issues.length, 2)
    assert.equal(data.issues[0].status, 'todo')
  })

  test('invalid relation type is rejected and no relation is stored', async () => {
    await fails('add_relation', { key: 'PRM-1', type: 'parent', targetKey: 'PRM-2' }, /type must be one of: blocks, duplicate, related/)
    assert.deepEqual(data.issues[0].relations, [])
  })

  test('relating an issue to itself is rejected', async () => {
    await fails('add_relation', { key: 'PRM-1', type: 'related', targetKey: 'PRM-1' }, /cannot relate to itself/)
    assert.deepEqual(data.issues[0].relations, [])
  })

  test('invalid priority is rejected', async () => {
    await fails('update_issue', { key: 'PRM-1', priority: 7 }, /priority must be 0/)
    assert.equal(data.issues[0].priority, 0)
  })

  test('server keeps answering after tool errors', async () => {
    await fails('get_issue', { key: 'ZZZ-1' }, /Issue not found/)
    const reply = await rpc('ping')
    assert.deepEqual(reply.result, {})
  })

  test('unknown tool name returns a JSON-RPC error', async () => {
    const reply = await rpc('tools/call', { name: 'no_such_tool', arguments: {} })
    assert.equal(reply.error?.code, -32602)
    assert.match(reply.error?.message ?? '', /Unknown tool: no_such_tool/)
  })

  test('update_project rejects an invalid status', async () => {
    await fails('update_project', { projectId: 'PRM', status: 'bogus' }, /status/)
    assert.equal(data.projects[0].status, 'in_progress')
  })
})
