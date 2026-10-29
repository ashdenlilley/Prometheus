import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { viewShowsCompleted, withoutCompleted } from '../../src/shared/query'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import { DEFAULT_STATUSES, type Issue, type Project } from '../../src/shared/types'

const project = (): Project =>
  blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000', statuses: DEFAULT_STATUSES })

// createIssue numbers issues from the data passed in, so pass an explicit number via the patch.
const issue = (number: number, status: string): Issue =>
  createIssue(emptyData(), 'p1', `Issue ${number}`, { number, status })

describe('withoutCompleted', () => {
  test('drops completed and canceled issues and keeps backlog, unstarted and started', () => {
    const items = [
      issue(1, 'backlog'),
      issue(2, 'todo'),
      issue(3, 'in_progress'),
      issue(4, 'done'),
      issue(5, 'canceled')
    ]
    const kept = withoutCompleted(items, project())
    assert.deepEqual(kept.map(i => i.number), [1, 2, 3])
  })

  test('empty input returns an empty list', () => {
    assert.deepEqual(withoutCompleted([], project()), [])
  })

  test('unknown status id is kept, matching categoryOf which defaults to unstarted', () => {
    const kept = withoutCompleted([issue(1, 'mystery')], project())
    assert.deepEqual(kept.map(i => i.number), [1])
  })

  test('without a project, nothing is known to be completed so all issues are kept', () => {
    const items = [issue(1, 'done'), issue(2, 'canceled')]
    assert.deepEqual(withoutCompleted(items, undefined).map(i => i.number), [1, 2])
  })
})

describe('viewShowsCompleted', () => {
  test('saved views without the flag show completed issues', () => {
    assert.equal(viewShowsCompleted({}), true)
  })

  test('the stored flag wins when present', () => {
    assert.equal(viewShowsCompleted({ showCompleted: false }), false)
    assert.equal(viewShowsCompleted({ showCompleted: true }), true)
  })
})
