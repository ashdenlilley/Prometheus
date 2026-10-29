import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { weekStarts, workloadBuckets } from '../../src/shared/workload'
import { createIssue } from '../../src/shared/model'
import { DEFAULT_STATUSES, type Issue } from '../../src/shared/types'
import { emptyData } from '../../src/shared/seed'

const issue = (patch: Partial<Issue>): Issue => ({ ...createIssue(emptyData(), 'p1', 'Task', patch), ...patch })
const opts = { from: '2026-10-29', weeks: 3, measure: 'points' as const, statuses: DEFAULT_STATUSES }

describe('weekStarts', () => {
  test('returns consecutive Mondays starting with the week containing the date', () => {
    // 2026-10-29 is a Thursday, so its week starts Monday 2026-10-26.
    assert.deepEqual(weekStarts('2026-10-29', 3), ['2026-10-26', '2026-11-02', '2026-11-09'])
    assert.deepEqual(weekStarts('2026-10-26', 1), ['2026-10-26'])
  })
})

describe('workloadBuckets', () => {
  test('buckets an issue by its due date', () => {
    const rows = workloadBuckets([issue({ assignee: 'Ana', dueDate: '2026-11-03', estimate: 3 })], opts)
    assert.deepEqual(rows, [{ person: 'Ana', weeks: [0, 3, 0] }])
  })

  test('spreads points evenly across a timeline range', () => {
    // Oct 28 (Wed) to Nov 4 (Wed) touches two weeks: each gets half.
    const rows = workloadBuckets([issue({ assignee: 'Ana', startDate: '2026-10-28', dueDate: '2026-11-04', estimate: 4 })], opts)
    assert.deepEqual(rows, [{ person: 'Ana', weeks: [2, 2, 0] }])
  })

  test('counts issues per week instead of points', () => {
    const rows = workloadBuckets(
      [issue({ assignee: 'Ana', startDate: '2026-10-28', dueDate: '2026-11-04', estimate: 4 }), issue({ assignee: 'Ana', dueDate: '2026-11-10' })],
      { ...opts, measure: 'count' }
    )
    // The ranged issue counts once in each of its two weeks; the due-dated one lands in week three.
    assert.deepEqual(rows, [{ person: 'Ana', weeks: [1, 1, 1] }])
  })

  test('done, canceled, archived and unassigned issues are left out', () => {
    const rows = workloadBuckets(
      [
        issue({ assignee: 'Ana', dueDate: '2026-11-03', status: 'done' }),
        issue({ assignee: 'Ana', dueDate: '2026-11-03', status: 'canceled' }),
        issue({ assignee: 'Ana', dueDate: '2026-11-03', archivedAt: '2026-10-30T00:00:00.000Z' }),
        issue({ assignee: 'Unassigned', dueDate: '2026-11-03' }),
        issue({ assignee: 'Ana', dueDate: '2026-11-03' })
      ],
      opts
    )
    assert.deepEqual(rows, [{ person: 'Ana', weeks: [0, 1, 0] }])
  })
})
