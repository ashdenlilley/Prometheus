import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { reducer, createIssue } from '../../src/shared/model'
import { emptyData } from '../../src/shared/seed'
import { WriteLimiter, activeAgents, agentAssignee, agentIdOf, displayAssignee, isAgentAssignee, stampActor } from '../../src/shared/agents'
import type { Agent, AppData } from '../../src/shared/types'

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: 'a1',
  name: 'Claude Code',
  color: '#e8833a',
  level: 'comment',
  tokenHash: 'hash',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over
})

describe('assignee strings', () => {
  test('agent assignees round-trip through the prefix', () => {
    assert.equal(agentAssignee('a1'), 'agent:a1')
    assert.equal(isAgentAssignee('agent:a1'), true)
    assert.equal(isAgentAssignee('Ashden'), false)
    assert.equal(agentIdOf('agent:a1'), 'a1')
    assert.equal(agentIdOf('Ashden'), undefined)
  })

  test('display shows the agent name, Unknown agent for a missing one, and the plain string for people', () => {
    const data: AppData = { ...emptyData(), agents: [agent()] }
    assert.equal(displayAssignee(data, 'agent:a1'), 'Claude Code')
    assert.equal(displayAssignee(data, 'agent:gone'), 'Unknown agent')
    assert.equal(displayAssignee(data, 'agent:legacy'), 'Unnamed agent')
    assert.equal(displayAssignee(data, 'Ashden'), 'Ashden')
  })

  test('activeAgents leaves out revoked agents and copes with a missing list', () => {
    const data: AppData = { ...emptyData(), agents: [agent(), agent({ id: 'a2', revokedAt: '2026-10-02T00:00:00.000Z' })] }
    assert.deepEqual(activeAgents(data).map(a => a.id), ['a1'])
    assert.deepEqual(activeAgents(emptyData()), [])
  })
})

describe('stampActor', () => {
  test('stamps only the activity entries added since prev, and keeps existing actors', () => {
    const base = emptyData()
    const issue = createIssue(base, 'p1', 'Login bug')
    const old = { id: 'old', at: '2026-10-01T00:00:00.000Z', text: 'Created' }
    const prev: AppData = { ...base, issues: [{ ...issue, activity: [old] }] }
    const fresh = { id: 'new', at: '2026-10-02T00:00:00.000Z', text: 'Status changed' }
    const kept = { id: 'kept', at: '2026-10-02T00:00:00.000Z', text: 'Other', actor: 'me' }
    const next: AppData = { ...prev, issues: [{ ...issue, activity: [old, fresh, kept] }] }

    const out = stampActor(prev, next, 'agent:a1')
    assert.deepEqual(out.issues[0].activity, [old, { ...fresh, actor: 'agent:a1' }, kept])
  })

  test('stamps every entry on an issue that is new', () => {
    const base = emptyData()
    const issue = createIssue(base, 'p1', 'New')
    const entry = { id: 'e1', at: '2026-10-02T00:00:00.000Z', text: 'Created' }
    const next: AppData = { ...base, issues: [{ ...issue, activity: [entry] }] }
    assert.equal(stampActor(base, next, 'agent:legacy').issues[0].activity[0].actor, 'agent:legacy')
  })

  test('returns the same object when nothing was added', () => {
    const data = emptyData()
    assert.equal(stampActor(data, data, 'me'), data)
  })
})

describe('WriteLimiter', () => {
  test('refuses after the limit within the window and recovers when the window slides', () => {
    let t = 0
    const limiter = new WriteLimiter(2, 1000, () => t)
    assert.deepEqual(limiter.hit('a1'), { ok: true, firstTrip: false })
    assert.deepEqual(limiter.hit('a1'), { ok: true, firstTrip: false })
    assert.deepEqual(limiter.hit('a1'), { ok: false, firstTrip: true })
    t = 500
    assert.deepEqual(limiter.hit('a1'), { ok: false, firstTrip: false })
    t = 1001
    assert.deepEqual(limiter.hit('a1'), { ok: true, firstTrip: false })
  })

  test('limits each agent separately', () => {
    const limiter = new WriteLimiter(1, 1000, () => 0)
    assert.equal(limiter.hit('a1').ok, true)
    assert.equal(limiter.hit('a2').ok, true)
    assert.equal(limiter.hit('a1').ok, false)
  })

  test('firstTrip is set once per run of refusals', () => {
    let t = 0
    const limiter = new WriteLimiter(1, 1000, () => t)
    limiter.hit('a1')
    assert.equal(limiter.hit('a1').firstTrip, true)
    assert.equal(limiter.hit('a1').firstTrip, false)
    assert.equal(limiter.hit('a1').firstTrip, false)
  })
})

describe('agent reducer actions', () => {
  test('addAgent appends to a missing list', () => {
    const next = reducer(emptyData(), { type: 'addAgent', agent: agent() })
    assert.deepEqual(next.agents, [agent()])
  })

  test('patchAgent changes name, colour and level only', () => {
    const start = { ...emptyData(), agents: [agent()] }
    const next = reducer(start, { type: 'patchAgent', id: 'a1', patch: { name: 'Cursor', level: 'write' } })
    assert.deepEqual(next.agents, [agent({ name: 'Cursor', level: 'write' })])
  })

  test('revokeAgent sets revokedAt and keeps the row', () => {
    const start = { ...emptyData(), agents: [agent()] }
    const next = reducer(start, { type: 'revokeAgent', id: 'a1', at: '2026-10-03T00:00:00.000Z' })
    assert.equal(next.agents?.length, 1)
    assert.equal(next.agents?.[0].revokedAt, '2026-10-03T00:00:00.000Z')
  })
})
