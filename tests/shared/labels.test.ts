import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { availableLabels, enforceLabelGroups, labelGroups } from '../../src/shared/labels'
import { applyFilter } from '../../src/shared/filter'
import { groupIssues } from '../../src/shared/query'
import { createIssue, reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, LabelDef } from '../../src/shared/types'

const shared: LabelDef[] = [
  { name: 'P1', color: '#e2445c', group: 'Priority' },
  { name: 'P2', color: '#fdab3d', group: 'Priority' },
  { name: 'Backend', color: '#579bfc' }
]

// Space s1 holds the shared labels. Project p1 has issues; p2 is empty.
const withLabels = (labels?: LabelDef[]): AppData => ({
  ...emptyData(),
  spaces: [{ id: 's1', name: 'Work', color: '#000000', labels }],
  projects: [
    blankProject({ id: 'p1', spaceId: 's1', name: 'Core', key: 'CORE', color: '#000000' }),
    blankProject({ id: 'p2', spaceId: 's1', name: 'Other', key: 'OTH', color: '#000000' })
  ],
  issues: [
    createIssue(emptyData(), 'p1', 'Login', { id: 'i1', labels: ['P1', 'bug'] }),
    createIssue(emptyData(), 'p1', 'API', { id: 'i2', labels: ['Backend'] }),
    createIssue(emptyData(), 'p1', 'Typo', { id: 'i3', labels: ['bug'] })
  ]
})

describe('availableLabels', () => {
  test('shared labels come first, then the project labels that are not shared, sorted by name', () => {
    const data = withLabels(shared)
    data.issues[0].labels = ['zeta', 'p1', 'bug']
    data.issues[1].labels = ['Backend']
    assert.deepEqual(availableLabels(data, data.projects[0]), [
      { name: 'P1', color: '#e2445c', group: 'Priority', shared: true },
      { name: 'P2', color: '#fdab3d', group: 'Priority', shared: true },
      { name: 'Backend', color: '#579bfc', shared: true },
      { name: 'bug', shared: false },
      { name: 'zeta', shared: false }
    ])
  })

  test('a project with no issues only offers the shared labels', () => {
    assert.deepEqual(
      availableLabels(withLabels(shared), withLabels(shared).projects[1]).map(l => l.name),
      ['P1', 'P2', 'Backend']
    )
  })
})

describe('labelGroups', () => {
  test('lists each group of the shared labels once, and nothing for a space without labels', () => {
    assert.deepEqual(labelGroups(withLabels(shared), 's1'), ['Priority'])
    assert.deepEqual(labelGroups(withLabels(undefined), 's1'), [])
  })
})

describe('enforceLabelGroups', () => {
  const defs: LabelDef[] = [...shared, { name: 'bug', color: '#000000' }]

  test('keeps the label newly added to a group and drops the one it replaces', () => {
    assert.deepEqual(enforceLabelGroups(['P1'], ['P1', 'P2'], defs), ['P2'])
  })

  test('when several labels of a group are new, keeps the last one', () => {
    assert.deepEqual(enforceLabelGroups([], ['P1', 'P2'], defs), ['P2'])
  })

  test('leaves ungrouped labels alone', () => {
    assert.deepEqual(enforceLabelGroups(['P1', 'bug'], ['P1', 'bug', 'P2', 'Backend'], defs), ['bug', 'P2', 'Backend'])
  })

  test('matches label names case-insensitively', () => {
    assert.deepEqual(enforceLabelGroups(['p1'], ['P1', 'P2'], defs), ['P2'])
    assert.deepEqual(enforceLabelGroups(['P2'], ['p2', 'P1'], defs), ['P1'])
  })
})

describe('label groups through the reducer', () => {
  test('patchIssue enforces the group', () => {
    const out = reducer(withLabels(shared), { type: 'patchIssue', id: 'i1', patch: { labels: ['P1', 'P2', 'bug'] } })
    assert.deepEqual(out.issues[0].labels, ['P2', 'bug'])
  })

  test('patchIssues (bulk) enforces the group on every issue', () => {
    const out = reducer(withLabels(shared), { type: 'patchIssues', ids: ['i2', 'i3'], patch: { labels: ['P1', 'P2'] } })
    assert.deepEqual(out.issues[1].labels, ['P2'])
    assert.deepEqual(out.issues[2].labels, ['P2'])
  })

  test('old data without labels on the space keeps labels untouched', () => {
    const out = reducer(withLabels(undefined), { type: 'patchIssue', id: 'i1', patch: { labels: ['P1', 'P2'] } })
    assert.deepEqual(out.issues[0].labels, ['P1', 'P2'])
  })
})

describe('shared labels in filters and grouping', () => {
  const data = withLabels(shared)
  const project = data.projects[0]

  test('filter by a shared label and by a project label', () => {
    const byShared = { match: 'all' as const, conditions: [{ key: 'labels', op: 'is' as const, value: 'Backend' }] }
    const byProject = { match: 'all' as const, conditions: [{ key: 'labels', op: 'is' as const, value: 'bug' }] }
    assert.deepEqual(applyFilter(data.issues, byShared, project).map(i => i.id), ['i2'])
    assert.deepEqual(applyFilter(data.issues, byProject, project).map(i => i.id), ['i1', 'i3'])
  })

  test('group by labels puts issues under shared and project labels', () => {
    const groups = groupIssues(data.issues, project, 'labels', () => '', () => '')
    assert.deepEqual(
      Object.fromEntries(groups.map(g => [g.label, g.items.map(i => i.id)])),
      { P1: ['i1'], Backend: ['i2'], bug: ['i3'] }
    )
  })
})
