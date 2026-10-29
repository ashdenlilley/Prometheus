import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { applyFilter, fieldValue } from '../../src/shared/filter'
import { issuesToRows } from '../../src/shared/query'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { FilterGroup, Issue, Project } from '../../src/shared/types'

const project = (): Project => blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000', columns: [] })

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

describe('PR field', () => {
  test("fieldValue('pr') is the issue's PR state, undefined without one", () => {
    assert.equal(fieldValue(issue({ prState: 'draft' }), 'pr', project()), 'draft')
    assert.equal(fieldValue(issue(), 'pr', project()), undefined)
  })

  test('filters by PR state, with an empty value meaning no PR', () => {
    const items = [issue({ id: 'a', prState: 'open' }), issue({ id: 'b', prState: 'merged' }), issue({ id: 'c' })]
    const filterOn = (value: string): FilterGroup => ({ match: 'all', conditions: [{ key: 'pr', op: 'is', value }] })
    assert.deepEqual(applyFilter(items, filterOn('merged'), project()).map(i => i.id), ['b'])
    assert.deepEqual(applyFilter(items, filterOn(''), project()).map(i => i.id), ['c'])
    assert.deepEqual(applyFilter(items, { match: 'all', conditions: [{ key: 'pr', op: 'empty' }] }, project()).map(i => i.id), ['c'])
  })

  test('CSV export has a PR column with the state label', () => {
    const p = project()
    const data = { ...emptyData(), projects: [p], issues: [issue({ prState: 'closed' }), issue({ id: 'i2', number: 2 })] }
    const [header, first, second] = issuesToRows(data, p, data.issues)
    const at = header.indexOf('PR')
    assert.ok(at > 0)
    assert.equal(first[at], 'Closed')
    assert.equal(second[at], '')
  })
})
