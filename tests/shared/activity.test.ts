import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { activityField, page, projectActivity } from '../../src/shared/activity'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, Issue } from '../../src/shared/types'

// Local-noon timestamps, so the local calendar day in the filter is the day written here.
const at = (m: number, d: number) => new Date(2026, m - 1, d, 12).toISOString()

const issue = (patch: Partial<Issue> & Pick<Issue, 'id' | 'number'>): Issue => ({
  ...createIssue(emptyData(), 'p1', `Issue ${patch.number}`, { number: patch.number }),
  ...patch
})

const withData = (issues: Issue[]): AppData => ({
  ...emptyData(),
  projects: [
    blankProject({ id: 'p1', spaceId: 's1', name: 'Home', key: 'HOME', color: '#000000' }),
    blankProject({ id: 'p2', spaceId: 's1', name: 'Work', key: 'WORK', color: '#111111' })
  ],
  issues
})

const a = issue({
  id: 'a',
  number: 1,
  activity: [
    { id: 'a1', at: at(1, 5), text: 'Status: Backlog → Done' },
    { id: 'a2', at: at(1, 7), text: 'Priority: none → 2' }
  ]
})
const b = issue({
  id: 'b',
  number: 2,
  activity: [{ id: 'b1', at: at(1, 6), text: 'Due: none → 2026-02-01' }],
  comments: [{ id: 'c1', author: 'Ann', body: 'x'.repeat(100), at: at(1, 9) }]
})
const other = issue({ id: 'o', number: 1, projectId: 'p2', activity: [{ id: 'o1', at: at(1, 8), text: 'Labels: work' }] })

describe('projectActivity', () => {
  test('merges every issue in the project, newest first, with the issue key', () => {
    const rows = projectActivity(withData([a, b, other]), 'p1', {})
    assert.deepEqual(
      rows.map(r => [r.key, r.at]),
      [
        ['HOME-2', at(1, 9)],
        ['HOME-1', at(1, 7)],
        ['HOME-2', at(1, 6)],
        ['HOME-1', at(1, 5)]
      ]
    )
    assert.equal(rows[1].title, 'Issue 1')
  })

  test('comments come in as "author: first 80 chars" with field comment', () => {
    const [comment] = projectActivity(withData([b]), 'p1', { field: 'comment' })
    assert.equal(comment.kind, 'comment')
    assert.equal(comment.text, `Ann: ${'x'.repeat(80)}`)
    assert.equal(comment.field, 'comment')
  })

  test('filters by issue', () => {
    const rows = projectActivity(withData([a, b]), 'p1', { issueId: 'b' })
    assert.deepEqual(rows.map(r => r.issueId), ['b', 'b'])
  })

  test('filters by field', () => {
    const rows = projectActivity(withData([a, b]), 'p1', { field: 'status' })
    assert.deepEqual(rows.map(r => r.text), ['Status: Backlog → Done'])
  })

  test('date range is inclusive on both ends', () => {
    const rows = projectActivity(withData([a, b]), 'p1', { from: '2026-01-05', to: '2026-01-07' })
    assert.deepEqual(rows.map(r => r.text), ['Priority: none → 2', 'Due: none → 2026-02-01', 'Status: Backlog → Done'])
    assert.deepEqual(projectActivity(withData([a, b]), 'p1', { from: '2026-01-06', to: '2026-01-06' }).map(r => r.text), ['Due: none → 2026-02-01'])
  })

  test('empty project gives an empty list', () => {
    assert.deepEqual(projectActivity(withData([a, b]), 'nope', {}), [])
    assert.deepEqual(projectActivity(withData([]), 'p1', {}), [])
  })
})

describe('activityField', () => {
  test('reads the field from the text prefix, unknown text is other', () => {
    assert.equal(activityField('Status: Backlog → Done'), 'status')
    assert.equal(activityField('Labels: a, b'), 'labels')
    assert.equal(activityField('Created from HOME-1 (recurring)'), 'created')
    assert.equal(activityField('Rolled over to next cycle'), 'other')
  })
})

describe('page', () => {
  const items = Array.from({ length: 120 }, (_, n) => n)

  test('returns full pages then the remainder', () => {
    assert.equal(page(items, 0, 50).length, 50)
    assert.equal(page(items, 0, 50)[0], 0)
    assert.equal(page(items, 2, 50).length, 20)
    assert.equal(page(items, 2, 50)[19], 119)
  })

  test('a page past the end is empty', () => {
    assert.deepEqual(page(items, 3, 50), [])
    assert.deepEqual(page([], 0, 50), [])
  })
})
