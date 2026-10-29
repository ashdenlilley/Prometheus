import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { reducer, createIssue, type Action } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, Issue } from '../../src/shared/types'
import {
  applyPatch,
  COALESCE_MS,
  diffData,
  emptyHistory,
  GESTURE_MS,
  LIMIT,
  mergePatches,
  withUndo,
  type HistoryAction,
  type WithHistory
} from '../../src/shared/history'

const issue = (number: number, patch: Partial<Issue> = {}): Issue =>
  createIssue(emptyData(), 'p1', `Issue ${number}`, { id: `i${number}`, number, ...patch })

const base = (): AppData => ({
  ...emptyData(),
  projects: [blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000' })],
  issues: [issue(1), issue(2), issue(3)]
})

// A clock the tests move by hand. Steps default to well past the coalescing window.
function harness(data: AppData = base()) {
  let t = 1_000_000
  const step = withUndo(reducer, () => t)
  let s: WithHistory = { data, history: emptyHistory() }
  return {
    get s() {
      return s
    },
    get data() {
      return s.data
    },
    run(a: HistoryAction, advance = 10_000) {
      t += advance
      s = step(s, a)
      return s
    }
  }
}

const titles = (d: AppData) => d.issues.map(i => i.title)
const find = (d: AppData, id: string) => d.issues.find(i => i.id === id)

describe('diffData and applyPatch', () => {
  test('an unchanged copy produces an empty patch', () => {
    const d = base()
    assert.deepEqual(diffData(d, d), { rows: [] })
  })

  test('records changed, added and removed rows with their positions', () => {
    const prev = base()
    const next = { ...prev, issues: [{ ...prev.issues[0], title: 'X' }, prev.issues[2], issue(4)] }
    const p = diffData(prev, next)
    const kinds = p.rows.map(r => `${r.id}:${r.before ? 'b' : ''}${r.after ? 'a' : ''}`).sort()
    assert.deepEqual(kinds, ['i1:ba', 'i2:b', 'i4:a'])
    assert.equal(p.rows.find(r => r.id === 'i2')?.beforeIndex, 1)
  })

  test('before restores the old rows and after replays the new ones', () => {
    const prev = base()
    const next = { ...prev, issues: [{ ...prev.issues[0], title: 'X' }, prev.issues[2], issue(4)] }
    const p = diffData(prev, next)
    assert.deepEqual(applyPatch(next, p, 'before'), prev)
    assert.deepEqual(applyPatch(prev, p, 'after'), next)
  })

  test('notifications are not part of a patch', () => {
    const prev = base()
    const next = { ...prev, notifications: [{ id: 'n1', issueId: 'i1', text: 'x', at: '2026-10-29T00:00:00Z', read: false }] }
    assert.deepEqual(diffData(prev, next).rows, [])
  })

  test('the display name is tracked', () => {
    const prev = base()
    const p = diffData(prev, { ...prev, me: 'Ashden' })
    assert.deepEqual(p.me, { before: prev.me, after: 'Ashden' })
    assert.equal(applyPatch({ ...prev, me: 'Ashden' }, p, 'before').me, prev.me)
  })

  test('merging keeps the first before and the last after, and drops add-then-delete', () => {
    const d0 = base()
    const d1 = { ...d0, issues: [...d0.issues, issue(4)] }
    const d2 = { ...d1, issues: d1.issues.filter(i => i.id !== 'i4').map(i => (i.id === 'i1' ? { ...i, title: 'A' } : i)) }
    const merged = mergePatches(diffData(d0, d1), diffData(d1, d2))
    assert.deepEqual(merged.rows.map(r => r.id), ['i1'])
    assert.deepEqual(applyPatch(d2, merged, 'before'), d0)
  })
})

describe('withUndo', () => {
  test('undo and redo a single issue edit', () => {
    const h = harness()
    const before = h.data
    h.run({ type: 'patchIssue', id: 'i2', patch: { title: 'Renamed' } })
    const after = h.data
    assert.equal(find(after, 'i2')?.title, 'Renamed')
    h.run({ type: 'undo' })
    assert.deepEqual(h.data, before)
    h.run({ type: 'redo' })
    assert.deepEqual(h.data, after)
  })

  test('undoing a delete puts the issue back in its old position', () => {
    const h = harness()
    h.run({ type: 'addComment', issueId: 'i2', comment: { id: 'c1', author: 'me', body: 'hi', at: '2026-10-29T00:00:00Z' } })
    h.run({ type: 'deleteIssue', id: 'i2' })
    assert.deepEqual(titles(h.data), ['Issue 1', 'Issue 3'])
    h.run({ type: 'undo' })
    assert.deepEqual(titles(h.data), ['Issue 1', 'Issue 2', 'Issue 3'])
    assert.equal(find(h.data, 'i2')?.comments.length, 1, 'the comments come back with the issue')
  })

  test('bulk edit and bulk delete are one undo step each', () => {
    const h = harness()
    const start = h.data
    h.run({ type: 'patchIssues', ids: ['i1', 'i3'], patch: { priority: 1 } })
    const edited = h.data
    h.run({ type: 'deleteIssues', ids: ['i1', 'i2'] })
    assert.deepEqual(titles(h.data), ['Issue 3'])
    h.run({ type: 'undo' })
    assert.deepEqual(h.data, edited)
    h.run({ type: 'undo' })
    assert.deepEqual(h.data, start)
    assert.equal(h.s.history.past.length, 0)
  })

  test('a CSV import (addIssues) is undone in one step', () => {
    const h = harness()
    const start = h.data
    h.run({ type: 'addIssues', issues: [issue(10), issue(11), issue(12)] })
    assert.equal(h.data.issues.length, 6)
    h.run({ type: 'undo' })
    assert.deepEqual(h.data, start)
  })

  test('deleting a project and its issues is undone together', () => {
    const h = harness()
    const start = h.data
    h.run({ type: 'deleteProject', id: 'p1' })
    assert.equal(h.data.projects.length, 0)
    h.run({ type: 'undo' })
    assert.deepEqual(h.data, start)
  })

  test('typing into one field quickly becomes one undo step', () => {
    const h = harness()
    const start = h.data
    for (const title of ['A', 'Ab', 'Abc']) h.run({ type: 'patchIssue', id: 'i1', patch: { title } }, COALESCE_MS / 4)
    assert.equal(h.s.history.past.length, 1)
    h.run({ type: 'undo' })
    assert.deepEqual(h.data, start)
  })

  test('edits further apart than the window are separate steps', () => {
    const h = harness()
    h.run({ type: 'patchIssue', id: 'i1', patch: { title: 'A' } })
    h.run({ type: 'patchIssue', id: 'i1', patch: { title: 'B' } }, COALESCE_MS + 1)
    assert.equal(h.s.history.past.length, 2)
    h.run({ type: 'undo' })
    assert.equal(find(h.data, 'i1')?.title, 'A')
  })

  test('different fields are not merged unless dispatched in the same gesture', () => {
    const h = harness()
    h.run({ type: 'patchIssue', id: 'i1', patch: { title: 'A' } })
    h.run({ type: 'patchIssue', id: 'i1', patch: { priority: 2 } }, GESTURE_MS * 2)
    assert.equal(h.s.history.past.length, 2)
    h.run({ type: 'patchIssue', id: 'i2', patch: { priority: 3 } }, GESTURE_MS - 1)
    assert.equal(h.s.history.past.length, 2, 'two dispatches inside one gesture share a step')
  })

  test('a merged step that ends where it started is dropped', () => {
    // patchIssue also bumps updatedAt, so use a row without timestamps to get a true round trip.
    const h = harness()
    h.run({ type: 'patchProject', id: 'p1', patch: { name: 'Testx' } })
    h.run({ type: 'patchProject', id: 'p1', patch: { name: 'Test' } }, 100)
    assert.equal(h.s.history.past.length, 0)
  })

  test('a new edit clears the redo stack', () => {
    const h = harness()
    h.run({ type: 'patchIssue', id: 'i1', patch: { title: 'A' } })
    h.run({ type: 'undo' })
    assert.equal(h.s.history.future.length, 1)
    h.run({ type: 'patchIssue', id: 'i2', patch: { title: 'B' } })
    assert.equal(h.s.history.future.length, 0)
    const s = h.s
    assert.equal(h.run({ type: 'redo' }), s, 'redo with nothing to redo is a no-op')
  })

  test('undo with an empty stack returns the same state', () => {
    const h = harness()
    const s = h.s
    assert.equal(h.run({ type: 'undo' }), s)
  })

  test('undo leaves changes from MCP or sync to other rows alone', () => {
    const h = harness()
    h.run({ type: 'patchIssue', id: 'i1', patch: { title: 'Mine' } })
    // An external change arrives as a full reload: issue 3 renamed, issue 4 added.
    const external = { ...h.data, issues: [...h.data.issues.map(i => (i.id === 'i3' ? { ...i, title: 'Theirs' } : i)), issue(4)] }
    h.run({ type: 'load', data: external })
    h.run({ type: 'undo' })
    assert.deepEqual(titles(h.data), ['Issue 1', 'Issue 2', 'Theirs', 'Issue 4'])
  })

  test('load, tick, notify and markNotifications are not undoable', () => {
    const h = harness()
    const acts: Action[] = [
      { type: 'load', data: { ...base(), issues: [issue(9)] } },
      { type: 'tick', today: '2026-10-29' },
      { type: 'notify', notification: { id: 'n1', issueId: 'i9', text: 'x', at: '2026-10-29T00:00:00Z', read: false } },
      { type: 'markNotifications', read: true }
    ]
    for (const a of acts) h.run(a)
    assert.equal(h.s.history.past.length, 0)
  })

  test(`history keeps at most ${LIMIT} steps`, () => {
    const h = harness()
    for (let n = 0; n < LIMIT + 5; n++) h.run({ type: 'patchIssue', id: 'i1', patch: { title: `T${n}` } })
    assert.equal(h.s.history.past.length, LIMIT)
    for (let n = 0; n < LIMIT; n++) h.run({ type: 'undo' })
    assert.equal(find(h.data, 'i1')?.title, 'T4', 'the oldest steps are dropped')
  })
})
