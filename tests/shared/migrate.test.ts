import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { migrate } from '../../src/shared/migrate'
import { emptyData, seed } from '../../src/shared/seed'

// A pre-v4 file with one project, one issue and no defaults filled in.
function legacyFile(overrides: Record<string, unknown> = {}): unknown {
  return {
    version: 3,
    projects: [
      { id: 'p1', spaceId: 's1', name: 'Core', key: 'CORE', color: '#111111', status: 'in_progress', lead: 'Ada', members: ['Ada'], columns: [], cycleLength: 30, autoCycles: true }
    ],
    issues: [
      { id: 'i1', projectId: 'p1', number: 1, title: 'First', status: 'todo', priority: 2, values: {} }
    ],
    ...overrides
  }
}

describe('migrate: current version passthrough', () => {
  test('returns a version 5 file as the same object', () => {
    const current = seed()
    assert.equal(migrate(current), current)
  })

  test('returns an empty version 5 file unchanged', () => {
    const current = emptyData()
    assert.equal(migrate(current), current)
  })
})

describe('migrate: missing fields get defaults', () => {
  test('an empty legacy file becomes an empty version 5 file with a Workspace space', () => {
    const out = migrate({ projects: [], issues: [] })
    assert.equal(out.version, 5)
    assert.equal(out.spaces.length, 1)
    assert.equal(out.spaces[0].name, 'Workspace')
    assert.equal(out.spaces[0].color, '#5e6ad2')
    assert.deepEqual(out.projects, [])
    assert.deepEqual(out.issues, [])
    assert.deepEqual(out.cycles, [])
    assert.deepEqual(out.automations, [])
    assert.deepEqual(out.triageRules, [])
    assert.deepEqual(out.templates, [])
    assert.deepEqual(out.dashboards, [])
    assert.deepEqual(out.notifications, [])
    assert.deepEqual(out.initiatives, [])
    assert.equal(out.me, 'You')
  })

  test('a missing spaces list is replaced by a Workspace that projects without spaceId attach to', () => {
    const out = migrate({ projects: [{ id: 'p1', name: 'Core', key: 'CORE', color: '#111111', columns: [] }], issues: [] })
    assert.equal(out.spaces.length, 1)
    assert.equal(out.projects[0].spaceId, out.spaces[0].id)
  })

  test('a project without spaceId is attached to the first existing space', () => {
    const out = migrate(
      legacyFile({
        spaces: [{ id: 'sA', name: 'Alpha', color: '#abcdef' }],
        projects: [{ id: 'p1', name: 'Core', key: 'CORE', color: '#111111', columns: [] }],
        issues: []
      })
    )
    assert.equal(out.projects[0].spaceId, 'sA')
  })

  test('a project gets the default widths, statuses and view settings when they are missing', () => {
    const [p] = migrate(legacyFile()).projects
    assert.deepEqual(p.widths, {})
    assert.equal(p.statuses.length, 5)
    assert.deepEqual(p.hiddenColumns, [])
    assert.deepEqual(p.wipLimits, {})
    assert.deepEqual(p.milestones, [])
    assert.deepEqual(p.updates, [])
    assert.deepEqual(p.views, [])
  })

  test('an issue without relations, comments, activity or values gets empty lists and values', () => {
    const issue = { id: 'i2', projectId: 'p1', number: 2, title: 'Bare', status: 'todo', priority: 0 }
    const [i] = migrate(legacyFile({ issues: [issue] })).issues
    assert.deepEqual(i.relations, [])
    assert.deepEqual(i.comments, [])
    assert.deepEqual(i.activity, [])
    assert.deepEqual(i.values, {})
  })

  test('a missing cycles list becomes an empty list', () => {
    assert.deepEqual(migrate(legacyFile()).cycles, [])
  })

  test('an issue with an unknown status falls back to backlog', () => {
    const issue = { id: 'i3', projectId: 'p1', number: 3, title: 'Odd', status: 'archived', priority: 0, values: {} }
    const [i] = migrate(legacyFile({ issues: [issue] })).issues
    assert.equal(i.status, 'backlog')
  })

  test('a missing version field is treated as a legacy file', () => {
    const out = migrate({ projects: [], issues: [] })
    assert.equal(out.version, 5)
  })
})

describe('migrate: existing data is preserved', () => {
  test('project fields that are already set are kept', () => {
    const [p] = migrate(legacyFile({ spaces: [{ id: 's1', name: 'Main', color: '#000000' }] })).projects
    assert.equal(p.id, 'p1')
    assert.equal(p.name, 'Core')
    assert.equal(p.key, 'CORE')
    assert.equal(p.status, 'in_progress')
    assert.equal(p.lead, 'Ada')
    assert.deepEqual(p.members, ['Ada'])
    assert.equal(p.cycleLength, 30)
    assert.equal(p.autoCycles, true)
  })

  test('issue fields that are already set are kept', () => {
    const [i] = migrate(legacyFile()).issues
    assert.equal(i.id, 'i1')
    assert.equal(i.projectId, 'p1')
    assert.equal(i.number, 1)
    assert.equal(i.title, 'First')
    assert.equal(i.status, 'todo')
    assert.equal(i.priority, 2)
  })

  test('existing spaces and cycles are kept as they are', () => {
    const spaces = [{ id: 'sA', name: 'Alpha', color: '#abcdef' }]
    const cycles = [{ id: 'c1', projectId: 'p1', name: 'Cycle 1', startDate: '2026-01-01', endDate: '2026-01-14' }]
    const out = migrate(legacyFile({ spaces, cycles }))
    assert.deepEqual(out.spaces, spaces)
    assert.deepEqual(out.cycles, cycles.map(c => ({ ...c, teamId: 'team-p1' })))
  })

  test('issue values that are not select or people columns are kept unchanged', () => {
    const project = {
      id: 'p1',
      spaceId: 's1',
      name: 'Core',
      key: 'CORE',
      color: '#111111',
      columns: [
        { id: 'est', name: 'Estimate', type: 'number' },
        { id: 'due', name: 'Due', type: 'date' }
      ]
    }
    const issue = { id: 'i1', projectId: 'p1', number: 1, title: 'T', status: 'todo', priority: 0, values: { est: 5, due: '2026-02-01' } }
    const [i] = migrate(legacyFile({ projects: [project], issues: [issue] })).issues
    assert.deepEqual(i.values, { est: 5, due: '2026-02-01' })
  })
})

describe('migrate: legacy select and people values', () => {
  const selectProject = {
    id: 'p1',
    spaceId: 's1',
    name: 'Core',
    key: 'CORE',
    color: '#111111',
    columns: [
      { id: 'pri', name: 'Priority', type: 'select', options: ['High', 'Low'] },
      { id: 'who', name: 'Owner', type: 'people' }
    ]
  }

  test('a select column becomes a dropdown with one option per label', () => {
    const [p] = migrate(legacyFile({ projects: [selectProject], issues: [] })).projects
    assert.deepEqual(p.columns[0], {
      id: 'pri',
      name: 'Priority',
      type: 'dropdown',
      options: [
        { id: 'opt0-High', label: 'High', color: '#579bfc' },
        { id: 'opt1-Low', label: 'Low', color: '#579bfc' }
      ]
    })
  })

  test('a select column without an options array becomes a dropdown with no options', () => {
    const project = { ...selectProject, columns: [{ id: 'pri', name: 'Priority', type: 'select' }] }
    const [p] = migrate(legacyFile({ projects: [project], issues: [] })).projects
    assert.equal(p.columns[0].type, 'dropdown')
    assert.deepEqual(p.columns[0].options, [])
  })

  test('a select value stored as a label is rewritten to the matching option id', () => {
    const issue = { id: 'i1', projectId: 'p1', number: 1, title: 'T', status: 'todo', priority: 0, values: { pri: 'Low' } }
    const [i] = migrate(legacyFile({ projects: [selectProject], issues: [issue] })).issues
    assert.deepEqual(i.values, { pri: 'opt1-Low' })
  })

  test('a select value whose label is no longer an option is kept as it was', () => {
    const issue = { id: 'i1', projectId: 'p1', number: 1, title: 'T', status: 'todo', priority: 0, values: { pri: 'Gone' } }
    const [i] = migrate(legacyFile({ projects: [selectProject], issues: [issue] })).issues
    assert.deepEqual(i.values, { pri: 'Gone' })
  })

  test('a single person string becomes a one-item list, and an empty string becomes an empty list', () => {
    const issues = [
      { id: 'i1', projectId: 'p1', number: 1, title: 'A', status: 'todo', priority: 0, values: { who: 'Ada' } },
      { id: 'i2', projectId: 'p1', number: 2, title: 'B', status: 'todo', priority: 0, values: { who: '' } }
    ]
    const out = migrate(legacyFile({ projects: [selectProject], issues })).issues
    assert.deepEqual(out[0].values, { who: ['Ada'] })
    assert.deepEqual(out[1].values, { who: [] })
  })
})

describe('migrate: idempotence', () => {
  test('migrating a legacy file twice gives the same result as migrating it once', () => {
    const once = migrate(legacyFile())
    assert.deepEqual(migrate(once), once)
  })

  test('migrating a file with select and people columns twice gives the same result as once', () => {
    const project = {
      id: 'p1',
      name: 'Core',
      key: 'CORE',
      color: '#111111',
      columns: [
        { id: 'pri', name: 'Priority', type: 'select', options: ['High'] },
        { id: 'who', name: 'Owner', type: 'people' }
      ]
    }
    const issue = { id: 'i1', projectId: 'p1', number: 1, title: 'T', status: 'done', priority: 0, values: { pri: 'High', who: 'Ada' } }
    const once = migrate({ version: 2, projects: [project], issues: [issue] })
    assert.deepEqual(migrate(once), once)
  })

  test('migrating a current file is a no-op', () => {
    const current = seed()
    assert.deepEqual(migrate(migrate(current)), current)
  })
})

describe('migrate: malformed and edge input', () => {
  test('a null input throws a TypeError', () => {
    assert.throws(() => migrate(null), TypeError)
  })

  test('a legacy file with a project-less issue keeps that issue and its values', () => {
    const issue = { id: 'i9', projectId: 'missing', number: 1, title: 'Orphan', status: 'todo', priority: 0, values: { x: 'Y' } }
    const [i] = migrate(legacyFile({ issues: [issue] })).issues
    assert.equal(i.projectId, 'missing')
    assert.deepEqual(i.values, { x: 'Y' })
  })

  test('an empty spaces list still gets a default Workspace space', () => {
    const out = migrate(legacyFile({ spaces: [] }))
    assert.equal(out.spaces.length, 1)
  })

  test('top-level data outside spaces, projects, issues and cycles is preserved', () => {
    const out = migrate(legacyFile({ me: 'Ada' }))
    assert.equal(out.me, 'Ada')
  })
})
