import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { monthGrid, parseISO } from '../../src/shared/dates'
import { portfolioRows } from '../../src/shared/insights'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import { DEFAULT_STATUSES, type AppData } from '../../src/shared/types'

describe('monthGrid', () => {
  test('starts on the Monday on or before the 1st and covers 42 days', () => {
    // 2026-02-01 is a Sunday, so the grid starts the Monday six days before it.
    const grid = monthGrid(2026, 2)
    assert.equal(grid.length, 42)
    assert.equal(grid[0], '2026-01-26')
    assert.equal(parseISO(grid[0]).getDay(), 1)
    assert.ok(grid.includes('2026-02-01'))
    assert.ok(grid.includes('2026-02-28'))
    assert.equal(grid[41], '2026-03-08')
  })

  test('covers November, which starts on a Sunday', () => {
    const grid = monthGrid(2026, 11)
    assert.equal(grid[0], '2026-10-26')
    assert.equal(parseISO(grid[0]).getDay(), 1)
    assert.ok(grid.includes('2026-11-01'))
    assert.ok(grid.includes('2026-11-30'))
  })

  test('a month that starts on a Monday has no leading days', () => {
    // 2026-06-01 is a Monday.
    assert.equal(monthGrid(2026, 6)[0], '2026-06-01')
  })
})

const done = DEFAULT_STATUSES.find(s => s.category === 'completed')!.id

const withData = (): AppData => ({
  ...emptyData(),
  projects: [
    blankProject({
      id: 'p1',
      spaceId: 's1',
      name: 'Home',
      key: 'HOME',
      color: '#000000',
      lead: 'Ann',
      status: 'in_progress',
      targetDate: '2026-03-01',
      updates: [
        { id: 'u1', at: '2026-01-01T00:00:00.000Z', health: 'on_track', body: '' },
        { id: 'u2', at: '2026-02-01T00:00:00.000Z', health: 'at_risk', body: '' }
      ]
    }),
    blankProject({ id: 'p2', spaceId: 's1', name: 'Garden', key: 'GARD', color: '#111111' }),
    blankProject({ id: 'p3', spaceId: 's2', name: 'Other space', key: 'OTH', color: '#222222' })
  ],
  issues: [
    createIssue(emptyData(), 'p1', 'Done', { number: 1, status: done }),
    createIssue(emptyData(), 'p1', 'Open', { number: 2 }),
    createIssue(emptyData(), 'p1', 'Triage', { number: 3, triage: true }),
    createIssue(emptyData(), 'p3', 'Elsewhere', { number: 1 })
  ]
})

describe('portfolioRows', () => {
  test('gives progress, lead, target date and health from the latest update', () => {
    const [row] = portfolioRows(withData(), 's1', 'p1')
    assert.deepEqual(row, { id: 'p1', name: 'Home', status: 'in_progress', lead: 'Ann', pct: 50, targetDate: '2026-03-01', health: 'at_risk' })
  })

  test('missing values stay undefined so the UI can show dashes', () => {
    const row = portfolioRows(withData(), 's1').find(r => r.id === 'p2')!
    assert.equal(row.lead, '')
    assert.equal(row.targetDate, undefined)
    assert.equal(row.health, undefined)
    assert.equal(row.pct, 0)
  })

  test('lists only the space, or just the one project when given', () => {
    assert.deepEqual(portfolioRows(withData(), 's1').map(r => r.id), ['p1', 'p2'])
    assert.deepEqual(portfolioRows(withData(), 's1', 'p2').map(r => r.id), ['p2'])
  })
})
