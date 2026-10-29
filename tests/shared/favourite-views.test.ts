import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { favouriteViews, viewIdFor } from '../../src/shared/views'
import { blankProject } from '../../src/shared/seed'
import { DEFAULT_STATUSES, type Project, type SavedView } from '../../src/shared/types'

const view = (id: string, favourite?: boolean): SavedView => ({
  id,
  name: `View ${id}`,
  view: 'list',
  filter: { match: 'all', conditions: [] },
  groupBy: null,
  sort: null,
  hidden: [],
  favourite
})

const project = (id: string, views: SavedView[]): Project => ({
  ...blankProject({ id, spaceId: 's1', name: `Project ${id}`, key: id.toUpperCase(), color: '#000000', statuses: DEFAULT_STATUSES }),
  views
})

describe('favouriteViews', () => {
  test('keeps only favourites, in project then view order', () => {
    const a = project('a', [view('a1', true), view('a2'), view('a3', true)])
    const b = project('b', [view('b1', true)])
    const result = favouriteViews([a, b])
    assert.deepEqual(result.map(r => r.view.id), ['a1', 'a3', 'b1'])
    assert.deepEqual(result.map(r => r.project.id), ['a', 'a', 'b'])
  })

  test('drops views that are unfavourited or never favourited', () => {
    const a = project('a', [view('a1', false), view('a2')])
    assert.deepEqual(favouriteViews([a]), [])
  })

  test('follows the order of the projects passed in', () => {
    const a = project('a', [view('a1', true)])
    const b = project('b', [view('b1', true)])
    assert.deepEqual(favouriteViews([b, a]).map(r => r.view.id), ['b1', 'a1'])
  })
})

describe('viewIdFor', () => {
  test('maps each saved-view kind to the page it opens', () => {
    assert.equal(viewIdFor('list'), 'issues')
    assert.equal(viewIdFor('board'), 'board')
    assert.equal(viewIdFor('table'), 'table')
    assert.equal(viewIdFor('chart'), 'chart')
  })
})
