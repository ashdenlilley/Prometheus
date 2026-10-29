import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveColumnLayout } from '../../src/shared/views'
import { blankProject } from '../../src/shared/seed'
import type { Project, SavedView } from '../../src/shared/types'

const project = (patch: Partial<Project> = {}): Project => blankProject({ id: 'p1', spaceId: 's1', name: 'Home', key: 'HOME', color: '#000000', ...patch })

const view = (patch: Partial<SavedView> = {}): SavedView => ({
  id: 'v1',
  name: 'Mine',
  view: 'table',
  filter: { match: 'all', conditions: [] },
  groupBy: null,
  sort: null,
  hidden: [],
  ...patch
})

describe('resolveColumnLayout', () => {
  test('a view with its own order uses that order, not the project one', () => {
    const p = project({ order: ['due', 'status'] })
    assert.deepEqual(resolveColumnLayout(p, view({ order: ['status', 'due'] })).order, ['status', 'due'])
  })

  test('an old view without an order falls back to the project order', () => {
    const p = project({ order: ['due', 'status'] })
    assert.deepEqual(resolveColumnLayout(p, view({ hidden: ['labels'] })).order, ['due', 'status'])
  })

  test('no view uses the project order and hidden columns', () => {
    const p = project({ order: ['due'], hiddenColumns: ['start'] })
    assert.deepEqual(resolveColumnLayout(p), { order: ['due'], hidden: ['start'] })
  })

  test('no view and no saved order leaves the order undefined', () => {
    assert.deepEqual(resolveColumnLayout(project()), { order: undefined, hidden: [] })
  })

  test('hidden is the union of project and view columns, without duplicates', () => {
    const p = project({ hiddenColumns: ['start', 'due'] })
    assert.deepEqual(resolveColumnLayout(p, view({ hidden: ['due', 'labels'] })).hidden, ['start', 'due', 'labels'])
  })
})
