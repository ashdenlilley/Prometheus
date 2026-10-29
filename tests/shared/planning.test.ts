import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { averageVelocity, capacityStatus, cyclePoints } from '../../src/shared/planning'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, Cycle, Issue } from '../../src/shared/types'

const cycle = (id: string, endDate: string): Cycle => ({ id, projectId: 'p1', name: id, startDate: endDate, endDate })
const issue = (patch: Partial<Issue>): Issue => ({ ...createIssue(emptyData(), 'p1', 'Task', patch), ...patch })

describe('cyclePoints', () => {
  test('sums estimates in the cycle and skips canceled issues', () => {
    const statuses = blankProject({ id: 'p1', spaceId: 's1', name: 'Home', key: 'HOME', color: '#000000' }).statuses
    const issues = [
      issue({ cycleId: 'c1', estimate: 3 }),
      issue({ cycleId: 'c1', estimate: 5, status: 'done' }),
      issue({ cycleId: 'c1', estimate: 8, status: 'canceled' }),
      issue({ cycleId: 'c2', estimate: 2 }),
      issue({ cycleId: 'c1' })
    ]
    assert.equal(cyclePoints(issues, 'c1', statuses), 8)
  })
})

describe('averageVelocity', () => {
  const project = blankProject({ id: 'p1', spaceId: 's1', name: 'Home', key: 'HOME', color: '#000000' })
  const data: AppData = {
    ...emptyData(),
    projects: [project],
    cycles: [cycle('old', '2026-08-01'), cycle('a', '2026-09-01'), cycle('b', '2026-09-15'), cycle('c', '2026-10-01'), cycle('future', '2026-12-01')],
    issues: [
      issue({ cycleId: 'old', estimate: 100, status: 'done' }),
      issue({ cycleId: 'a', estimate: 4, status: 'done' }),
      issue({ cycleId: 'b', estimate: 6, status: 'done' }),
      issue({ cycleId: 'c', estimate: 2, status: 'done' }),
      issue({ cycleId: 'c', estimate: 9 }),
      issue({ cycleId: 'future', estimate: 50, status: 'done' })
    ]
  }

  test('averages completed points over the last three cycles that ended before today', () => {
    // Last three ended: c (2), b (6), a (4) → mean 4.
    assert.equal(averageVelocity(data, 'p1', '2026-10-29'), 4)
  })

  test('is 0 when no cycle has ended', () => {
    assert.equal(averageVelocity(data, 'p1', '2026-07-01'), 0)
  })
})

describe('capacityStatus', () => {
  test('is over when planned points exceed capacity', () => {
    assert.deepEqual(capacityStatus(13, 10), { ratio: 1.3, over: true })
  })

  test('is under or equal when planned points fit', () => {
    assert.deepEqual(capacityStatus(10, 10), { ratio: 1, over: false })
    assert.deepEqual(capacityStatus(4, 10), { ratio: 0.4, over: false })
  })

  test('is never over without a capacity', () => {
    assert.deepEqual(capacityStatus(40), { ratio: 0, over: false })
  })
})
