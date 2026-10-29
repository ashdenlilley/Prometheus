import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { reducer, createIssue } from '../../src/shared/model'
import { emptyHistory, withUndo } from '../../src/shared/history'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, Comment } from '../../src/shared/types'

const base = (comments: Comment[] = []): AppData => ({
  ...emptyData(),
  me: 'Ada',
  projects: [blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000' })],
  issues: [createIssue(emptyData(), 'p1', 'Login', { id: 'i1', number: 1, comments, updatedAt: '2026-01-01T00:00:00Z' })]
})

const comment = (patch: Partial<Comment> = {}): Comment => ({ id: 'c1', author: 'Grace', body: 'hi', at: '2026-10-29T00:00:00Z', ...patch })
const issueOf = (d: AppData) => d.issues[0]

describe('comment files', () => {
  test('a comment with files round-trips through the reducer', () => {
    const file = { name: 'log.txt', size: 3, dataUrl: 'data:text/plain;base64,YWJj' }
    const out = reducer(base(), { type: 'addComment', issueId: 'i1', comment: comment({ body: '', files: [file] }) })
    assert.deepEqual(issueOf(out).comments[0].files, [file])
    assert.equal(issueOf(out).comments[0].body, '')
  })
})

describe('toggleReaction', () => {
  test('adds then removes the same reaction', () => {
    const d = base([comment()])
    const added = reducer(d, { type: 'toggleReaction', issueId: 'i1', commentId: 'c1', emoji: '👍', by: 'Ada' })
    assert.deepEqual(issueOf(added).comments[0].reactions, [{ emoji: '👍', by: 'Ada' }])
    const removed = reducer(added, { type: 'toggleReaction', issueId: 'i1', commentId: 'c1', emoji: '👍', by: 'Ada' })
    assert.deepEqual(issueOf(removed).comments[0].reactions, [])
  })

  test('reactions by different people are kept apart', () => {
    let d = base([comment()])
    d = reducer(d, { type: 'toggleReaction', issueId: 'i1', commentId: 'c1', emoji: '👍', by: 'Ada' })
    d = reducer(d, { type: 'toggleReaction', issueId: 'i1', commentId: 'c1', emoji: '👍', by: 'Grace' })
    d = reducer(d, { type: 'toggleReaction', issueId: 'i1', commentId: 'c1', emoji: '🎉', by: 'Ada' })
    assert.deepEqual(issueOf(d).comments[0].reactions, [
      { emoji: '👍', by: 'Ada' },
      { emoji: '👍', by: 'Grace' },
      { emoji: '🎉', by: 'Ada' }
    ])
    d = reducer(d, { type: 'toggleReaction', issueId: 'i1', commentId: 'c1', emoji: '👍', by: 'Ada' })
    assert.deepEqual(issueOf(d).comments[0].reactions, [
      { emoji: '👍', by: 'Grace' },
      { emoji: '🎉', by: 'Ada' }
    ])
  })

  test('does not bump the issue updatedAt', () => {
    const d = reducer(base([comment()]), { type: 'toggleReaction', issueId: 'i1', commentId: 'c1', emoji: '👀', by: 'Ada' })
    assert.equal(issueOf(d).updatedAt, '2026-01-01T00:00:00Z')
  })

  test('old comments without reactions or files work', () => {
    const d = base([comment()])
    assert.equal(issueOf(d).comments[0].reactions, undefined)
    assert.equal(issueOf(d).comments[0].files, undefined)
    const out = reducer(d, { type: 'toggleReaction', issueId: 'i1', commentId: 'c1', emoji: '🚀', by: 'Ada' })
    assert.equal(issueOf(out).comments[0].files, undefined)
    assert.deepEqual(issueOf(out).comments[0].reactions, [{ emoji: '🚀', by: 'Ada' }])
  })

  test('undo of a toggled reaction removes it again', () => {
    let t = 1_000_000
    const step = withUndo(reducer, () => t)
    let s = { data: base([comment()]), history: emptyHistory() }
    s = step(s, { type: 'toggleReaction', issueId: 'i1', commentId: 'c1', emoji: '👍', by: 'Ada' })
    assert.equal(issueOf(s.data).comments[0].reactions?.length, 1)
    t += 10_000
    s = step(s, { type: 'undo' })
    assert.deepEqual(issueOf(s.data).comments[0].reactions ?? [], [])
  })
})
