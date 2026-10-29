import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { emptyFilter } from '../../src/shared/query'
import { blankProject, emptyData, seed } from '../../src/shared/seed'
import { adoptPersonal, applyOps, Clock, diffOps, snapshotOps, type Op } from '../../src/shared/sync'
import type { AppData, Project, SavedView } from '../../src/shared/types'

const view = (id: string, personal?: boolean): SavedView => ({
  id,
  name: id,
  view: 'list',
  filter: emptyFilter(),
  groupBy: null,
  sort: null,
  hidden: [],
  ...(personal && { personal: true })
})

const withViews = (views: SavedView[]): AppData => ({
  ...emptyData(),
  projects: [blankProject({ id: 'p1', spaceId: 's1', name: 'Home', key: 'HOME', color: '#000000', views })]
})

const viewsOf = (data: AppData): SavedView[] => (data.projects as Project[])[0].views

// The `views` value from every project op, ignoring ops that do not carry views.
const viewOps = (ops: Op[]) => ops.filter(o => o.table === 'projects' && o.set && 'views' in o.set).map(o => o.set!.views as SavedView[])

describe('personal views', () => {
  test('adding a personal view produces no sync ops', () => {
    const before = withViews([view('shared')])
    const after = withViews([view('shared'), view('mine', true)])
    assert.deepEqual(diffOps(before, after, new Clock('dev')), [])
  })

  test('adding a shared view syncs without the personal ones', () => {
    const before = withViews([view('mine', true)])
    const after = withViews([view('mine', true), view('shared')])
    const ops = diffOps(before, after, new Clock('dev'))
    const sent = viewOps(ops)
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0].map(v => v.id), ['shared'])
  })

  test('applying a remote views change keeps local personal views', () => {
    const local = withViews([view('mine', true), view('old')])
    const { data } = applyOps(local, [{ hlc: '000000000000001.000000.remote', table: 'projects', id: 'p1', set: { views: [view('incoming')] } }])
    assert.deepEqual(viewsOf(data).map(v => v.id), ['incoming', 'mine'])
  })

  test('snapshot leaves personal views out', () => {
    const data = withViews([view('shared'), view('mine', true)])
    const ops = snapshotOps(data, new Map(), 'dev')
    const sent = viewOps(ops)
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0].map(v => v.id), ['shared'])
  })
})

describe('adoptPersonal', () => {
  test('main state adopts the renderer personal views, which produce no ops', () => {
    const state = emptyData()
    state.projects = [blankProject({ id: 'p1', spaceId: 's1', name: 'P', key: 'P', color: 'blue' })]
    const mine = view('v1', true)
    const incoming = { ...state, projects: [{ ...state.projects[0], views: [mine] }] }
    assert.equal(diffOps(state, incoming, new Clock('d1')).length, 0)
    const adopted = adoptPersonal(state, incoming)
    assert.deepEqual(adopted.projects[0].views, [mine])
    assert.equal(adoptPersonal(adopted, incoming), adopted)
  })
})

test('a snapshot applied onto empty data creates projects with their views', () => {
  const source = seed()
  const result = applyOps(emptyData(), snapshotOps(source, new Map(), 'dev'))
  assert.equal(result.data.projects.length, source.projects.length)
  assert.equal(result.data.issues.length, source.issues.length)
  assert.deepEqual(result.data.projects[0].views, source.projects[0].views.filter(v => !v.personal))
})
