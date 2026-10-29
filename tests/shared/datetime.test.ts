import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dateValueMs, fromLocalInput, toLocalInput } from '../../src/shared/datetime'
import { applyFilter } from '../../src/shared/filter'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { Column, Issue, Project } from '../../src/shared/types'

// Expected values are built from local fields so the tests hold in any timezone.
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()

describe('datetime', () => {
  test('toLocalInput and fromLocalInput round trip', () => {
    const local16 = '2026-03-15T14:30'
    assert.equal(toLocalInput(fromLocalInput(local16)), local16)
    assert.equal(fromLocalInput(''), '')
  })

  test('date-only values become local midnight in toLocalInput', () => {
    assert.equal(toLocalInput('2026-03-15'), '2026-03-15T00:00')
  })

  test('dateValueMs orders date-only and timestamps on the same day', () => {
    const midnight = dateValueMs('2026-03-15')
    const morning = dateValueMs(fromLocalInput('2026-03-15T09:00'))
    const evening = dateValueMs(fromLocalInput('2026-03-15T18:00'))
    assert.equal(midnight, local(2026, 3, 15))
    assert.ok(midnight < morning && morning < evening)
  })

  test('dateValueMs orders across days', () => {
    assert.ok(dateValueMs('2026-03-15') < dateValueMs(fromLocalInput('2026-03-16T00:00')))
    assert.ok(dateValueMs(fromLocalInput('2026-03-14T23:59')) < dateValueMs('2026-03-15'))
  })

  test('invalid values give NaN', () => {
    assert.ok(Number.isNaN(dateValueMs('not a date')))
    assert.equal(fromLocalInput('garbage'), '')
  })

  test('gt and lt on a custom date column use time-aware comparison', () => {
    const col: Column = { id: 'when', name: 'When', type: 'date', includeTime: true }
    const project: Project = blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000', columns: [col] })
    const withValue = (number: number, value: string) =>
      createIssue(emptyData(), 'p1', `Issue ${number}`, { number, values: { when: value } })
    const items: Issue[] = [
      withValue(1, '2026-03-15'),
      withValue(2, fromLocalInput('2026-03-15T09:00')),
      withValue(3, fromLocalInput('2026-03-15T18:00')),
      withValue(4, fromLocalInput('2026-03-16T08:00')),
      withValue(5, '2026-03-16')
    ]
    const numbers = (op: 'gt' | 'lt', value: string) =>
      applyFilter(items, { match: 'all', conditions: [{ key: 'when', op, value }] }, project).map(i => i.number)

    // gt a date-only value: same-day timestamps are later than local midnight
    assert.deepEqual(numbers('gt', '2026-03-15'), [2, 3, 4, 5])
    // lt a same-day timestamp: only date-only midnight is earlier
    assert.deepEqual(numbers('lt', fromLocalInput('2026-03-15T09:00')), [1])
    assert.deepEqual(numbers('lt', '2026-03-16'), [1, 2, 3])
  })
})
