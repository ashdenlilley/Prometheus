import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { applyFilter, emptyFilter, fieldValue, isEmpty } from '../../src/shared/filter'
import { blankProject } from '../../src/shared/seed'
import type { Column, Condition, FilterGroup, Issue, Project } from '../../src/shared/types'

const col = (id: string, type: Column['type']): Column => ({ id, name: id, type })

const project = (columns: Column[] = []): Project =>
  blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000', columns })

const issue = (patch: Partial<Issue> = {}): Issue => ({
  id: 'i1',
  projectId: 'p1',
  number: 1,
  title: 'Fix login',
  description: '',
  status: 'todo',
  priority: 0,
  assignee: '',
  labels: [],
  relations: [],
  comments: [],
  activity: [],
  values: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch
})

const group = (match: FilterGroup['match'], ...conditions: Condition[]): FilterGroup => ({ match, conditions })

describe('fieldValue', () => {
  test('reads fixed fields from the issue', () => {
    const i = issue({ title: 'Fix login', status: 'in_progress', priority: 2, estimate: 3, dueDate: '2026-02-01' })
    const p = project()
    assert.equal(fieldValue(i, 'name', p), 'Fix login')
    assert.equal(fieldValue(i, 'status', p), 'in_progress')
    assert.equal(fieldValue(i, 'priority', p), 2)
    assert.equal(fieldValue(i, 'estimate', p), 3)
    assert.equal(fieldValue(i, 'due', p), '2026-02-01')
  })

  test('empty assignee reads as undefined, not empty string', () => {
    assert.equal(fieldValue(issue({ assignee: '' }), 'assignee', project()), undefined)
    assert.equal(fieldValue(issue({ assignee: 'ana' }), 'assignee', project()), 'ana')
  })

  test('favourite is yes/no, with a missing flag reading as no', () => {
    assert.equal(fieldValue(issue({ favourite: true }), 'favourite', project()), 'yes')
    assert.equal(fieldValue(issue({ favourite: false }), 'favourite', project()), 'no')
    assert.equal(fieldValue(issue(), 'favourite', project()), 'no')
  })

  test('unset optional fixed fields read as undefined; labels read as the array', () => {
    const p = project()
    assert.equal(fieldValue(issue(), 'due', p), undefined)
    assert.equal(fieldValue(issue(), 'cycle', p), undefined)
    assert.equal(fieldValue(issue(), 'milestone', p), undefined)
    assert.deepEqual(fieldValue(issue({ labels: ['bug', 'ui'] }), 'labels', p), ['bug', 'ui'])
  })

  test('custom column reads issue.values by column id', () => {
    const p = project([col('score', 'number'), col('owner', 'text')])
    const i = issue({ values: { score: 0, owner: 'ana' } })
    assert.equal(fieldValue(i, 'score', p), 0)
    assert.equal(fieldValue(i, 'owner', p), 'ana')
  })

  test('custom checkbox false is kept as false rather than dropped', () => {
    const p = project([col('done', 'checkbox')])
    assert.equal(fieldValue(issue({ values: { done: false } }), 'done', p), false)
  })

  test('custom date range reads start, falling back to end', () => {
    const p = project([col('window', 'timeline')])
    assert.equal(fieldValue(issue({ values: { window: { start: '2026-03-01', end: '2026-03-09' } } }), 'window', p), '2026-03-01')
    assert.equal(fieldValue(issue({ values: { window: { end: '2026-03-09' } } }), 'window', p), '2026-03-09')
    assert.equal(fieldValue(issue({ values: { window: {} } }), 'window', p), undefined)
  })

  test('unknown key, missing project and missing value all read as undefined', () => {
    const p = project([col('score', 'number')])
    assert.equal(fieldValue(issue(), 'nope', p), undefined)
    assert.equal(fieldValue(issue({ values: { score: 5 } }), 'score', undefined), undefined)
    assert.equal(fieldValue(issue(), 'score', p), undefined)
  })
})

describe('isEmpty', () => {
  test('undefined, empty string and empty array are empty', () => {
    assert.equal(isEmpty(undefined), true)
    assert.equal(isEmpty(''), true)
    assert.equal(isEmpty([]), true)
  })

  test('zero, false, whitespace and non-empty values are not empty', () => {
    assert.equal(isEmpty(0), false)
    assert.equal(isEmpty(false), false)
    assert.equal(isEmpty(' '), false)
    assert.equal(isEmpty(['a']), false)
  })
})

describe('emptyFilter', () => {
  test('is a match-all group with no conditions, and a fresh object each call', () => {
    const a = emptyFilter()
    assert.deepEqual(a, { match: 'all', conditions: [] })
    assert.notEqual(a, emptyFilter())
  })
})

describe('applyFilter', () => {
  const issues = [
    issue({ id: 'a', title: 'Fix login', status: 'todo', priority: 1, assignee: 'ana', labels: ['bug'], estimate: 2, dueDate: '2026-02-10' }),
    issue({ id: 'b', title: 'Write docs', status: 'done', priority: 3, assignee: '', labels: ['docs', 'ui'], estimate: 5, dueDate: '2026-03-01' }),
    issue({ id: 'c', title: 'Refactor API', status: 'todo', priority: 0, assignee: 'bo', labels: [] })
  ]
  const ids = (xs: Issue[]) => xs.map(x => x.id)

  test('no conditions returns the input array unchanged', () => {
    assert.equal(applyFilter(issues, emptyFilter(), project()), issues)
  })

  test('does not mutate the input array', () => {
    const copy = [...issues]
    applyFilter(issues, group('all', { key: 'status', op: 'is', value: 'todo' }), project())
    assert.deepEqual(issues, copy)
  })

  test('match all (AND) keeps only issues satisfying every condition', () => {
    const f = group('all', { key: 'status', op: 'is', value: 'todo' }, { key: 'assignee', op: 'is', value: 'bo' })
    assert.deepEqual(ids(applyFilter(issues, f, project())), ['c'])
  })

  test('match any (OR) keeps issues satisfying at least one condition', () => {
    const f = group('any', { key: 'assignee', op: 'is', value: 'ana' }, { key: 'status', op: 'is', value: 'done' })
    assert.deepEqual(ids(applyFilter(issues, f, project())), ['a', 'b'])
  })

  test('is matches a string and a numeric value by their string form', () => {
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'priority', op: 'is', value: 1 }), project())), ['a'])
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'priority', op: 'is', value: 0 }), project())), ['c'])
  })

  test('is checks membership for array fields', () => {
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'labels', op: 'is', value: 'ui' }), project())), ['b'])
  })

  test('is_not keeps issues that do not match, including those with no value', () => {
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'assignee', op: 'is_not', value: 'ana' }), project())), ['b', 'c'])
  })

  test('contains is case-insensitive substring match on text and array fields', () => {
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'name', op: 'contains', value: 'LOGIN' }), project())), ['a'])
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'labels', op: 'contains', value: 'DO' }), project())), ['b'])
  })

  test('empty and not_empty split issues on whether the field has a value', () => {
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'assignee', op: 'empty' }), project())), ['b'])
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'labels', op: 'not_empty' }), project())), ['a', 'b'])
  })

  test('gt and lt are strict on numbers, and skip issues with no value', () => {
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'estimate', op: 'gt', value: 2 }), project())), ['b'])
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'estimate', op: 'lt', value: 5 }), project())), ['a'])
  })

  test('gt and lt compare ISO date strings', () => {
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'due', op: 'gt', value: '2026-02-28' }), project())), ['b'])
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'due', op: 'lt', value: '2026-02-10' }), project())), [])
  })

  test('gt with no value matches nothing', () => {
    assert.deepEqual(applyFilter(issues, group('all', { key: 'estimate', op: 'gt' }), project()), [])
  })

  test('filters on a custom column by its id', () => {
    const p = project([col('region', 'text')])
    const withRegion = [issue({ id: 'x', values: { region: 'EMEA' } }), issue({ id: 'y', values: { region: 'APAC' } })]
    assert.deepEqual(ids(applyFilter(withRegion, group('all', { key: 'region', op: 'contains', value: 'emea' }), p)), ['x'])
  })

  test('an unknown key matches nothing for is, but everything for is_not', () => {
    assert.deepEqual(applyFilter(issues, group('all', { key: 'ghost', op: 'is', value: 'x' }), project()), [])
    assert.deepEqual(ids(applyFilter(issues, group('all', { key: 'ghost', op: 'is_not', value: 'x' }), project())), ['a', 'b', 'c'])
  })

  test('a filter on favourite selects only favourited issues', () => {
    const mixed = [issue({ id: 'f', favourite: true }), issue({ id: 'g' })]
    assert.deepEqual(ids(applyFilter(mixed, group('all', { key: 'favourite', op: 'is', value: 'yes' }), project())), ['f'])
  })
})
