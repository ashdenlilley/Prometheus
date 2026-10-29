import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { burndownSeries, createdVsCompleted } from '../../src/shared/insights'
import { createIssue } from '../../src/shared/model'
import { emptyData } from '../../src/shared/seed'
import { DEFAULT_STATUSES, type Cycle, type Issue } from '../../src/shared/types'

const cycle: Cycle = { id: 'c1', projectId: 'p1', name: 'Sprint', startDate: '2026-10-01', endDate: '2026-10-07' }

const issue = (number: number, patch: Partial<Issue> = {}): Issue =>
  createIssue(emptyData(), 'p1', `Issue ${number}`, { number, createdAt: '2026-09-20T09:00:00.000Z', ...patch })

describe('burndownSeries', () => {
  test('scope grows when an issue is added mid-cycle', () => {
    const issues = [issue(1), issue(2, { createdAt: '2026-10-03T09:00:00.000Z' })]
    const series = burndownSeries(cycle, issues, DEFAULT_STATUSES, '2026-10-07')
    assert.deepEqual(series.map(p => p.scope), [1, 1, 2, 2, 2, 2, 2])
  })

  test('remaining drops on the completion day', () => {
    const issues = [issue(1, { status: 'done', completedAt: '2026-10-04T15:00:00.000Z' }), issue(2)]
    const series = burndownSeries(cycle, issues, DEFAULT_STATUSES, '2026-10-07')
    assert.equal(series.find(p => p.day === '2026-10-03')?.remaining, 2)
    assert.equal(series.find(p => p.day === '2026-10-04')?.remaining, 1)
    assert.equal(series.find(p => p.day === '2026-10-07')?.remaining, 1)
  })

  test('canceled issues are ignored', () => {
    const issues = [issue(1, { status: 'canceled' }), issue(2)]
    const series = burndownSeries(cycle, issues, DEFAULT_STATUSES, '2026-10-02')
    assert.deepEqual(series.map(p => p.scope), [1, 1])
  })

  test('a cycle that has not started gives an empty series', () => {
    assert.deepEqual(burndownSeries(cycle, [issue(1)], DEFAULT_STATUSES, '2026-09-30'), [])
  })

  test('series stops at today', () => {
    const series = burndownSeries(cycle, [issue(1)], DEFAULT_STATUSES, '2026-10-03')
    assert.deepEqual(series.map(p => p.day), ['2026-10-01', '2026-10-02', '2026-10-03'])
  })
})

describe('createdVsCompleted', () => {
  const issues = [
    issue(1, { createdAt: '2026-10-01T09:00:00.000Z', status: 'done', completedAt: '2026-10-02T09:00:00.000Z' }),
    issue(2, { createdAt: '2026-10-02T09:00:00.000Z' }),
    issue(3, { createdAt: '2026-09-01T09:00:00.000Z' })
  ]

  test('day buckets count issues per day and ignore dates outside the range', () => {
    assert.deepEqual(createdVsCompleted(issues, '2026-10-01', '2026-10-03', 'day'), [
      { start: '2026-10-01', created: 1, completed: 0 },
      { start: '2026-10-02', created: 1, completed: 1 },
      { start: '2026-10-03', created: 0, completed: 0 }
    ])
  })

  test('week buckets start at from and the last one is cut at to', () => {
    assert.deepEqual(createdVsCompleted(issues, '2026-10-01', '2026-10-10', 'week'), [
      { start: '2026-10-01', created: 2, completed: 1 },
      { start: '2026-10-08', created: 0, completed: 0 }
    ])
  })
})
