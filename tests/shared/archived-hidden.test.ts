import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isLive, triggerDefault } from '../../src/shared/live'
import { portfolioRows } from '../../src/shared/insights'
import { projectActivity } from '../../src/shared/activity'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import { DEFAULT_STATUSES } from '../../src/shared/types'

function fixture() {
  const data = emptyData()
  const project = blankProject({ id: 'p1', spaceId: 's1', name: 'Core', key: 'PRM', color: 'blue' })
  data.spaces = [{ id: 's1', name: 'Space', color: 'blue' }]
  data.projects = [project]
  const live = createIssue(data, 'p1', 'Live', { number: 1, status: 'done', activity: [{ id: 'a1', at: '2026-10-01T00:00:00.000Z', text: 'Status: Todo → Done' }] })
  const gone = createIssue(data, 'p1', 'Gone', { number: 2, status: 'todo', archivedAt: '2026-10-02T00:00:00.000Z', activity: [{ id: 'a2', at: '2026-10-01T00:00:00.000Z', text: 'Archived automatically' }] })
  data.issues = [live, gone]
  return data
}

describe('archived issues are hidden', () => {
  test('isLive', () => {
    assert.equal(isLive({}), true)
    assert.equal(isLive({ archivedAt: '2026-10-01' }), false)
  })

  test('portfolio progress ignores archived issues', () => {
    const data = fixture()
    assert.equal(portfolioRows(data, 's1')[0].pct, 100)
    data.issues[1] = { ...data.issues[1], archivedAt: undefined }
    assert.equal(portfolioRows(data, 's1')[0].pct, 50)
  })

  test('project activity ignores archived issues and shows them again when unarchived', () => {
    const data = fixture()
    assert.deepEqual(projectActivity(data, 'p1', {}).map(a => a.title), ['Live'])
    data.issues[1] = { ...data.issues[1], archivedAt: undefined }
    assert.equal(projectActivity(data, 'p1', {}).length, 2)
  })
})

describe('triggerDefault', () => {
  test('resets the value for the new trigger type', () => {
    assert.equal(triggerDefault('status_changed', DEFAULT_STATUSES), DEFAULT_STATUSES[DEFAULT_STATUSES.length - 1].id)
    assert.equal(triggerDefault('priority_changed', DEFAULT_STATUSES), '1')
    assert.ok(Number.isFinite(Number(triggerDefault('priority_changed', DEFAULT_STATUSES))))
    assert.equal(triggerDefault('due_passed', DEFAULT_STATUSES), '')
  })
})
