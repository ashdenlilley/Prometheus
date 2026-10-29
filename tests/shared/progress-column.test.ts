import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { progressValue } from '../../src/shared/query'
import { createIssue } from '../../src/shared/model'
import { emptyData } from '../../src/shared/seed'
import { DEFAULT_STATUSES, type Column, type Issue } from '../../src/shared/types'

const statuses = DEFAULT_STATUSES
const doneStatus = statuses.find(s => s.category === 'completed')!.id
const openStatus = statuses.find(s => s.category === 'unstarted')!.id
const canceledStatus = statuses.find(s => s.category === 'canceled')!.id

const progressCol = (progressMode?: Column['progressMode']): Column => ({ id: 'prog', name: 'Progress', type: 'progress', progressMode })

// createIssue numbers issues from the data passed in, so pass an explicit number via the patch.
const issue = (number: number, patch: Partial<Issue> = {}): Issue =>
  createIssue(emptyData(), 'p1', `Issue ${number}`, { number, ...patch })

const sub = (parent: Issue, number: number, status: string): Issue => issue(number, { parentId: parent.id, status })

describe('progressValue', () => {
  test('manual is the default and reads the stored value', () => {
    const col = progressCol()
    const parent = issue(1, { values: { prog: 40 } })
    assert.equal(progressValue(col, parent, [parent], statuses), 40)
    assert.equal(progressValue(col, issue(2), [], statuses), 0)
    assert.equal(progressValue(progressCol('manual'), issue(3, { values: { prog: 250 } }), [], statuses), 100)
  })

  test('computed with 1 of 2 sub-issues done is 50', () => {
    const parent = issue(1, { status: openStatus })
    const subs = [sub(parent, 2, doneStatus), sub(parent, 3, openStatus)]
    assert.equal(progressValue(progressCol('subissues'), parent, [parent, ...subs], statuses), 50)
  })

  test('canceled sub-issues are ignored', () => {
    const parent = issue(1, { status: openStatus })
    const subs = [sub(parent, 2, doneStatus), sub(parent, 3, canceledStatus), sub(parent, 4, openStatus)]
    assert.equal(progressValue(progressCol('subissues'), parent, [parent, ...subs], statuses), 50)
  })

  test('no sub-issues and completed is 100', () => {
    const parent = issue(1, { status: doneStatus })
    assert.equal(progressValue(progressCol('subissues'), parent, [parent], statuses), 100)
  })

  test('no sub-issues and open is 0', () => {
    const parent = issue(1, { status: openStatus })
    assert.equal(progressValue(progressCol('subissues'), parent, [parent], statuses), 0)
  })
})
