import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createIssue } from '../../src/shared/model'
import { emptyData } from '../../src/shared/seed'
import { applyFilter } from '../../src/shared/filter'
import type { AppData, Issue } from '../../src/shared/types'

describe('assigneeType filter', () => {
  const data: AppData = emptyData()
  const issues: Issue[] = [
    createIssue(data, 'p1', 'agent work', { assignee: 'agent:a1' }),
    createIssue(data, 'p1', 'person work', { assignee: 'Ashden' }),
    createIssue(data, 'p1', 'nobody', { assignee: '' })
  ]
  const titles = (filter: Parameters<typeof applyFilter>[1]) => applyFilter(issues, filter, undefined).map(i => i.title)

  test('is agent matches agent assignees only', () => {
    assert.deepEqual(titles({ match: 'all', conditions: [{ key: 'assigneeType', op: 'is', value: 'agent' }] }), ['agent work'])
  })

  test('is person matches non-empty human assignees only', () => {
    assert.deepEqual(titles({ match: 'all', conditions: [{ key: 'assigneeType', op: 'is', value: 'person' }] }), ['person work'])
  })

  test('empty matches unassigned issues', () => {
    assert.deepEqual(titles({ match: 'all', conditions: [{ key: 'assigneeType', op: 'empty' }] }), ['nobody'])
  })
})
