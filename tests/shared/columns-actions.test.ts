import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createIssue, reducer } from '../../src/shared/model'
import { subtaskLabel, subtaskSummary } from '../../src/shared/subtasks'
import { toggleVote, voteCount, voters } from '../../src/shared/votes'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, AutomationAction, Column, Issue } from '../../src/shared/types'

const button = (action?: AutomationAction): Column => ({ id: 'b1', name: 'Approve', type: 'button', buttonAction: action, buttonLabel: action ? 'Approve' : undefined })

// One project with a single button column and one issue, which is the one pressed.
function withButton(col: Column): AppData {
  const base: AppData = { ...emptyData(), projects: [blankProject({ id: 'p1', spaceId: 's1', name: 'Home', key: 'HOME', color: '#000000', columns: [col] })] }
  return { ...base, issues: [createIssue(base, 'p1', 'Ship it')] }
}

const press = (data: AppData) => reducer(data, { type: 'pressButton', issueId: data.issues[0].id, columnId: 'b1' })

describe('button column', () => {
  test('pressButton counts clicks without an action', () => {
    const before = withButton(button())
    const once = press(before)
    const twice = press(once)
    assert.equal(once.issues[0].values.b1, 1)
    assert.equal(twice.issues[0].values.b1, 2)
    assert.equal(twice.issues[0].status, before.issues[0].status)
  })

  test('set_status changes the issue and the count in one step', () => {
    const data = withButton(button({ type: 'set_status', status: 'done' }))
    const done = data.projects[0].statuses.find(s => s.category === 'completed')!.id
    const out = press(data)
    assert.equal(out.issues[0].status, done)
    assert.equal(out.issues[0].values.b1, 1)
  })

  test('add_label adds the label to the pressed issue', () => {
    const out = press(withButton(button({ type: 'add_label', label: 'urgent' })))
    assert.deepEqual(out.issues[0].labels, ['urgent'])
  })

  test('create_issue makes a sub-issue of the pressed issue', () => {
    const data = withButton(button({ type: 'create_issue', title: 'Follow up' }))
    const out = press(data)
    assert.equal(out.issues.length, 2)
    assert.equal(out.issues[1].title, 'Follow up')
    assert.equal(out.issues[1].parentId, data.issues[0].id)
  })

  test('notify adds one notification named after the button', () => {
    const out = press(withButton(button({ type: 'notify', message: 'Approved' })))
    assert.equal(out.notifications.length, 1)
    assert.equal(out.notifications[0].text, 'Approved (Approve)')
  })
})

describe('subtasks column', () => {
  test('subtaskSummary counts completed and canceled sub-issues', () => {
    const data = withButton(button())
    const statuses = data.projects[0].statuses
    const done = statuses.find(s => s.category === 'completed')!.id
    const canceled = statuses.find(s => s.category === 'canceled')!.id
    const open = statuses.find(s => s.category === 'backlog')!.id
    const parent = data.issues[0]
    const kids: Issue[] = [done, done, canceled, open, open].map((status, n) => createIssue(data, 'p1', `Child ${n}`, { status, parentId: parent.id }))
    const withKids = { ...data, issues: [...data.issues, ...kids] }
    const s = subtaskSummary(withKids, parent.id)
    assert.deepEqual(s, { done: 3, total: 5, ratio: 0.6 })
    assert.equal(subtaskLabel(s), '3/5')
    assert.equal(subtaskLabel(subtaskSummary(data, parent.id)), '')
  })
})

describe('vote column', () => {
  test('voters migrates a count of 3 to 3 anonymous votes', () => {
    assert.deepEqual(voters(3), ['anonymous', 'anonymous', 'anonymous'])
    assert.equal(voteCount(3), 3)
    assert.deepEqual(voters(undefined), [])
  })

  test('toggleVote adds and removes me and keeps anonymous votes', () => {
    assert.deepEqual(toggleVote(2, 'Ada'), ['anonymous', 'anonymous', 'Ada'])
    assert.deepEqual(toggleVote(['anonymous', 'Ada'], 'Ada'), ['anonymous'])
    assert.deepEqual(toggleVote(['anonymous'], 'Ada'), ['anonymous', 'Ada'])
  })
})
