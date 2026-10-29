import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { autoRollOverCycles, createIssue, markRolledOver, reducer } from '../../src/shared/model'
import { emptyHistory, withUndo, type WithHistory } from '../../src/shared/history'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, Cycle, Issue } from '../../src/shared/types'

const cycle = (id: string, startDate: string, endDate: string): Cycle => ({ id, projectId: 'p1', name: id, startDate, endDate })

// Project p1 with the given cycles and issues. Issues are created with createIssue so they get the usual shape.
const setup = (cycles: Cycle[], issues: Partial<Issue>[] = [], project: Partial<Parameters<typeof blankProject>[0]> = {}): AppData => {
  let data: AppData = { ...emptyData(), projects: [blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000', columns: [], milestones: [], ...project })], cycles }
  issues.forEach((patch, n) => {
    data = { ...data, issues: [...data.issues, createIssue(data, 'p1', `Issue ${n + 1}`, { number: n + 1, cycleId: 'c1', ...patch })] }
  })
  return data
}

const on = { autoRollOver: true }
const cyclesOf = (s: AppData) => Object.fromEntries(s.issues.map(i => [i.title, i.cycleId]))

describe('autoRollOverCycles', () => {
  test('does nothing before the cycle end date', () => {
    const s = setup([cycle('c1', '2026-01-01', '2026-01-14'), cycle('c2', '2026-01-15', '2026-01-28')], [{ status: 'todo' }], on)
    assert.equal(autoRollOverCycles(s, '2026-01-14'), s)
  })

  test('after the end date moves unfinished issues and leaves completed ones', () => {
    const s = setup(
      [cycle('c1', '2026-01-01', '2026-01-14'), cycle('c2', '2026-01-15', '2026-01-28')],
      [{ status: 'todo' }, { status: 'in_progress' }, { status: 'done' }, { status: 'canceled' }],
      on
    )
    const out = autoRollOverCycles(s, '2026-01-15')
    assert.deepEqual(cyclesOf(out), { 'Issue 1': 'c2', 'Issue 2': 'c2', 'Issue 3': 'c1', 'Issue 4': 'c1' })
  })

  test('adds an activity entry to moved issues', () => {
    const s = setup([cycle('c1', '2026-01-01', '2026-01-14'), cycle('c2', '2026-01-15', '2026-01-28')], [{ status: 'todo' }], on)
    const out = autoRollOverCycles(s, '2026-01-20')
    assert.equal(out.issues[0].activity.at(-1)?.text, 'Rolled over to next cycle')
  })

  test('is idempotent and returns the same reference on a second run', () => {
    const s = setup([cycle('c1', '2026-01-01', '2026-01-14'), cycle('c2', '2026-01-15', '2026-01-28')], [{ status: 'todo' }], on)
    const once = autoRollOverCycles(s, '2026-01-20')
    assert.equal(autoRollOverCycles(once, '2026-01-20'), once)
  })

  test('is off by default', () => {
    const s = setup([cycle('c1', '2026-01-01', '2026-01-14'), cycle('c2', '2026-01-15', '2026-01-28')], [{ status: 'todo' }])
    assert.equal(autoRollOverCycles(s, '2026-01-20'), s)
  })

  test('with no next cycle and autoCycles off does nothing', () => {
    const s = setup([cycle('c1', '2026-01-01', '2026-01-14')], [{ status: 'todo' }], on)
    assert.equal(autoRollOverCycles(s, '2026-01-20'), s)
  })

  test('with no next cycle and autoCycles on creates one and moves the issues there', () => {
    const s = setup([cycle('c1', '2026-01-01', '2026-01-14')], [{ status: 'todo' }], { ...on, autoCycles: true, cycleLength: 7 })
    const out = autoRollOverCycles(s, '2026-01-20')
    const created = out.cycles.find(c => c.id !== 'c1')
    assert.deepEqual([created?.name, created?.startDate, created?.endDate], ['Cycle 2', '2026-01-15', '2026-01-21'])
    assert.equal(out.issues[0].cycleId, created?.id)
  })

  test('reducer runs the action through the same logic', () => {
    const s = setup([cycle('c1', '2026-01-01', '2026-01-14'), cycle('c2', '2026-01-15', '2026-01-28')], [{ status: 'todo' }], on)
    assert.equal(reducer(s, { type: 'autoRollOver', today: '2026-01-20' }).issues[0].cycleId, 'c2')
  })

  test('rolls through several ended cycles into the current one', () => {
    const s = setup(
      [cycle('c1', '2026-01-01', '2026-01-07'), cycle('c2', '2026-01-08', '2026-01-14'), cycle('c3', '2026-01-15', '2026-01-21')],
      [{ status: 'todo' }],
      on
    )
    assert.equal(autoRollOverCycles(s, '2026-01-16').issues[0].cycleId, 'c3')
  })

  test('skips cycles already marked as rolled over', () => {
    const s = setup([{ ...cycle('c1', '2026-01-01', '2026-01-14'), rolledOver: true }, cycle('c2', '2026-01-15', '2026-01-28')], [{ status: 'todo' }], on)
    assert.equal(autoRollOverCycles(s, '2026-01-20'), s)
  })
})

describe('markRolledOver', () => {
  test('marks ended cycles that have a next cycle, once', () => {
    const s = setup([cycle('c1', '2026-01-01', '2026-01-14'), cycle('c2', '2026-01-15', '2026-01-28')], [], on)
    const out = markRolledOver(s, '2026-01-20')
    assert.deepEqual(out.cycles.map(c => !!c.rolledOver), [true, false])
    assert.equal(markRolledOver(out, '2026-01-20'), out)
  })

  test('leaves cycles alone when auto roll-over is off or there is no next cycle', () => {
    const off = setup([cycle('c1', '2026-01-01', '2026-01-14'), cycle('c2', '2026-01-15', '2026-01-28')])
    assert.equal(markRolledOver(off, '2026-01-20'), off)
    const last = setup([cycle('c1', '2026-01-01', '2026-01-14')], [], on)
    assert.equal(markRolledOver(last, '2026-01-20'), last)
  })
})

describe('auto roll-over with undo', () => {
  test('undo puts the issues back and the next tick does not roll them over again', () => {
    const step = withUndo(reducer, () => 1_000_000)
    let w: WithHistory = {
      data: setup([cycle('c1', '2026-01-01', '2026-01-14'), cycle('c2', '2026-01-15', '2026-01-28')], [{ status: 'todo' }], on),
      history: emptyHistory()
    }
    w = step(w, { type: 'autoRollOver', today: '2026-01-20' })
    w = step(w, { type: 'markRolledOver', today: '2026-01-20' })
    assert.equal(w.data.issues[0].cycleId, 'c2')
    assert.equal(w.history.past.length, 1)
    w = step(w, { type: 'undo' })
    assert.equal(w.data.issues[0].cycleId, 'c1')
    w = step(w, { type: 'autoRollOver', today: '2026-01-20' })
    assert.equal(w.data.issues[0].cycleId, 'c1')
  })
})
