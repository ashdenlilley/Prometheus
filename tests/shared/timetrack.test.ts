import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { elapsedHours, formatElapsed, startTimer, stopTimer, trackedHours } from '../../src/shared/timetrack'
import { createIssue } from '../../src/shared/model'
import { emptyData } from '../../src/shared/seed'
import type { Issue } from '../../src/shared/types'

const at = (iso: string) => new Date(iso)

const issue = (patch: Partial<Issue> = {}): Issue => createIssue(emptyData(), 'p1', 'Write report', { number: 1, ...patch })

// The reducer applies a patchIssue as a shallow merge, so the helpers are tested the same way.
const apply = (i: Issue, patch: Partial<Issue>): Issue => ({ ...i, ...patch })

describe('time tracking', () => {
  test('start then stop adds the session to the column', () => {
    let i = issue()
    i = apply(i, startTimer(i, 'time', at('2026-10-01T09:00:00Z')))
    i = apply(i, stopTimer(i, at('2026-10-01T10:30:00Z')))
    assert.equal(i.values.time, 1.5)
    assert.equal(i.timer, undefined)
  })

  test('start, stop, start, stop accumulates the sessions', () => {
    let i = issue()
    i = apply(i, startTimer(i, 'time', at('2026-10-01T09:00:00Z')))
    i = apply(i, stopTimer(i, at('2026-10-01T10:00:00Z')))
    i = apply(i, startTimer(i, 'time', at('2026-10-01T11:00:00Z')))
    i = apply(i, stopTimer(i, at('2026-10-01T11:15:00Z')))
    assert.equal(i.values.time, 1.25)
  })

  test('a manual value plus a session gives the total', () => {
    let i = issue({ values: { time: 2 } })
    i = apply(i, startTimer(i, 'time', at('2026-10-01T09:00:00Z')))
    i = apply(i, stopTimer(i, at('2026-10-01T09:30:00Z')))
    assert.equal(i.values.time, 2.5)
  })

  test('a session is rounded to 0.01 hours when it stops', () => {
    const i = apply(issue(), startTimer(issue(), 'time', at('2026-10-01T09:00:00Z')))
    assert.equal(stopTimer(i, at('2026-10-01T09:01:40Z')).values?.time, 0.03)
  })

  test('starting on another column stops the running timer first, keeping its time', () => {
    let i = issue()
    i = apply(i, startTimer(i, 'a', at('2026-10-01T09:00:00Z')))
    i = apply(i, startTimer(i, 'b', at('2026-10-01T10:00:00Z')))
    assert.equal(i.values.a, 1)
    assert.deepEqual(i.timer, { columnId: 'b', start: '2026-10-01T10:00:00.000Z' })
  })

  test('a stored start gives the elapsed time from a later now, so a restart keeps counting', () => {
    const running = issue({ timer: { columnId: 'time', start: '2026-10-01T09:00:00.000Z' } })
    const restored: Issue = JSON.parse(JSON.stringify(running))
    assert.equal(trackedHours(restored, 'time', at('2026-10-01T09:45:00Z')), 0.75)
    assert.equal(elapsedHours(restored.timer!.start, at('2026-10-01T10:00:00Z')), 1)
  })

  test('trackedHours shows only the stored value for other columns', () => {
    const i = issue({ values: { time: 3 }, timer: { columnId: 'other', start: '2026-10-01T09:00:00.000Z' } })
    assert.equal(trackedHours(i, 'time', at('2026-10-01T10:00:00Z')), 3)
  })

  test('formatElapsed shows h:mm:ss', () => {
    assert.equal(formatElapsed(0), '0:00:00')
    assert.equal(formatElapsed(1), '1:00:00')
    assert.equal(formatElapsed(3725 / 3600), '1:02:05')
  })
})
