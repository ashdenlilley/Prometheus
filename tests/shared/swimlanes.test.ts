import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { groupPatch, swimlanes } from '../../src/shared/query'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import { DEFAULT_STATUSES, type Column, type Cycle, type Issue, type Project } from '../../src/shared/types'

const project = (columns: Column[] = [], milestones: Project['milestones'] = []): Project =>
  blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000', columns, milestones })

// createIssue numbers issues from the data passed in, so pass an explicit number via the patch.
const issue = (number: number, patch: Partial<Issue> = {}): Issue =>
  createIssue(emptyData(), 'p1', `Issue ${number}`, { number, ...patch })

const noName = () => ''
const statusIds = DEFAULT_STATUSES.map(s => s.id)

describe('swimlanes', () => {
  test('without rows returns one lane holding the column groups', () => {
    const items = [issue(1, { status: 'todo' }), issue(2, { status: 'done' })]
    const lanes = swimlanes(items, project(), 'status', null, noName, noName)
    assert.equal(lanes.length, 1)
    assert.equal(lanes[0].key, 'all')
    assert.equal(lanes[0].count, 2)
    assert.deepEqual(lanes[0].columns.map(c => c.key), statusIds)
    assert.deepEqual(lanes[0].columns.find(c => c.key === 'done')?.items.map(i => i.number), [2])
  })

  test('lanes by assignee share the status columns, including empty ones, with correct counts', () => {
    const items = [issue(1, { assignee: 'Ann', status: 'todo' }), issue(2, { assignee: 'Ann', status: 'done' }), issue(3, { assignee: '', status: 'todo' })]
    const lanes = swimlanes(items, project(), 'status', 'assignee', noName, noName)
    assert.deepEqual(lanes.map(l => l.label), ['Ann', 'None'])
    assert.deepEqual(lanes.map(l => l.count), [2, 1])

    const ann = lanes[0]
    assert.deepEqual(ann.columns.map(c => c.key), statusIds)
    assert.deepEqual(ann.columns.find(c => c.key === 'todo')?.items.map(i => i.number), [1])
    assert.deepEqual(ann.columns.find(c => c.key === 'done')?.items.map(i => i.number), [2])
    assert.deepEqual(ann.columns.find(c => c.key === 'in_progress')?.items, [])

    const none = lanes[1]
    assert.deepEqual(none.columns.map(c => c.key), statusIds)
    assert.deepEqual(none.columns.find(c => c.key === 'todo')?.items.map(i => i.number), [3])
    assert.deepEqual(none.columns.find(c => c.key === 'done')?.items, [])
  })

  test('lanes by priority follow the priority order', () => {
    const items = [issue(1, { priority: 4 }), issue(2, { priority: 1 }), issue(3, { priority: 3 })]
    const lanes = swimlanes(items, project(), null, 'priority', noName, noName)
    assert.deepEqual(lanes.map(l => l.label), ['Urgent', 'Medium', 'Low'])
    assert.deepEqual(lanes.map(l => l.count), [1, 1, 1])
    assert.deepEqual(lanes[0].columns.map(c => c.items.length), [1])
  })
})

describe('groupPatch', () => {
  const cycles: Cycle[] = [
    { id: 'c1', projectId: 'p1', name: 'Sprint 1', startDate: '2026-01-01', endDate: '2026-01-14' },
    { id: 'c2', projectId: 'p2', name: 'Other', startDate: '2026-01-01', endDate: '2026-01-14' }
  ]
  const p = project([], [{ id: 'm1', name: 'Beta', done: false }])

  test('status key is the status id', () => {
    assert.deepEqual(groupPatch('status', 'done', p, cycles), { status: 'done' })
  })

  test('priority key maps to its PRIORITIES index, with "No priority" as 0', () => {
    assert.deepEqual(groupPatch('priority', 'Urgent', p, cycles), { priority: 1 })
    assert.deepEqual(groupPatch('priority', 'No priority', p, cycles), { priority: 0 })
    assert.equal(groupPatch('priority', 'Bogus', p, cycles), null)
  })

  test('assignee key is the name, with "None" clearing it', () => {
    assert.deepEqual(groupPatch('assignee', 'Ann', p, cycles), { assignee: 'Ann' })
    assert.deepEqual(groupPatch('assignee', 'None', p, cycles), { assignee: '' })
  })

  test('cycle key is looked up by name in this project, with "No cycle" clearing it', () => {
    assert.deepEqual(groupPatch('cycle', 'Sprint 1', p, cycles), { cycleId: 'c1' })
    assert.deepEqual(groupPatch('cycle', 'No cycle', p, cycles), { cycleId: undefined })
    assert.equal(groupPatch('cycle', 'Unknown', p, cycles), null)
    assert.equal(groupPatch('cycle', 'Other', p, cycles), null)
  })

  test('milestone key is looked up by name, with "No milestone" clearing it', () => {
    assert.deepEqual(groupPatch('milestone', 'Beta', p, cycles), { milestoneId: 'm1' })
    assert.deepEqual(groupPatch('milestone', 'No milestone', p, cycles), { milestoneId: undefined })
    assert.equal(groupPatch('milestone', 'Unknown', p, cycles), null)
  })

  test('unsupported fields return null', () => {
    assert.equal(groupPatch('labels', 'bug', p, cycles), null)
    assert.equal(groupPatch('team', 'Frontend', p, cycles), null)
  })
})
