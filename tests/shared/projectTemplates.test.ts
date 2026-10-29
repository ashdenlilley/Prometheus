import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { instantiateProjectTemplate, projectTemplateFrom } from '../../src/shared/projectTemplates'
import { createIssue, reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData } from '../../src/shared/types'

const NOW = '2026-06-01T00:00:00.000Z'

// A project with every kind of id: statuses, a column with an option, a milestone, a view, an automation, a triage rule and two issues.
const source = (): AppData => ({
  ...emptyData(),
  spaces: [{ id: 's1', name: 'Work', color: '#000000' }],
  projects: [
    blankProject({
      id: 'p1',
      spaceId: 's1',
      name: 'Core',
      key: 'CORE',
      color: '#000000',
      status: 'in_progress',
      columns: [{ id: 'colA', name: 'Team', type: 'dropdown', options: [{ id: 'optX', label: 'Red', color: '#f00000' }] }],
      milestones: [{ id: 'm1', name: 'Beta', date: '2026-05-01', done: true }],
      views: [{ id: 'v1', name: 'Mine', view: 'board', filter: { match: 'all', conditions: [{ key: 'status', op: 'is', value: 'done' }] }, groupBy: 'status', sort: null, hidden: ['colA'] }],
      wipLimits: { todo: 3 },
      hiddenColumns: ['colA'],
      widths: { colA: 120 },
      order: ['colA'],
      updates: [{ id: 'u1', at: '2026-05-02T00:00:00Z', health: 'on_track', body: 'Going well' }]
    })
  ],
  automations: [
    { id: 'a1', projectId: 'p1', name: 'Close', enabled: true, trigger: { type: 'status_changed', to: 'done' }, action: { type: 'set_status', status: 'todo' } }
  ],
  triageRules: [
    { id: 't1', projectId: 'p1', name: 'Triage', enabled: true, when: { match: 'all', conditions: [{ key: 'status', op: 'is', value: 'todo' }] }, set: { status: 'in_progress', labels: ['done'] } }
  ],
  issues: [
    createIssue(emptyData(), 'p1', 'Login', {
      id: 'i1',
      number: 1,
      status: 'done',
      labels: ['done'],
      values: { colA: 'optX' },
      milestoneId: 'm1',
      cycleId: 'c1',
      firedAutomations: ['a1:2026-01-01'],
      completedAt: '2026-05-03T00:00:00Z',
      favourite: true,
      comments: [{ id: 'c1', author: 'Ana', body: 'Done', at: '2026-05-01T00:00:00Z' }],
      activity: [{ id: 'e1', at: '2026-05-01T00:00:00Z', text: 'Created' }],
      relations: [{ type: 'related', targetId: 'i2' }]
    }),
    createIssue(emptyData(), 'p1', 'Child', { id: 'i2', number: 2, status: 'todo', parentId: 'i1' })
  ]
})

// Every id in the graph: id fields, status references, and keys of id-keyed maps and lists.
const ID_KEYS = new Set(['id', 'projectId', 'status', 'to', 'targetId', 'parentId', 'cycleId', 'milestoneId'])
const ID_MAPS = new Set(['values', 'widths', 'wipLimits'])
const ID_LISTS = new Set(['hidden', 'order', 'hiddenColumns'])
function idsIn(node: unknown, out = new Set<string>(), key = ''): Set<string> {
  if (typeof node === 'string') {
    if (ID_KEYS.has(key) || ID_LISTS.has(key)) out.add(node)
  } else if (Array.isArray(node)) {
    node.forEach(x => idsIn(x, out, key))
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (ID_MAPS.has(k) && v && typeof v === 'object') Object.keys(v).forEach(id => out.add(id))
      idsIn(v, out, k)
    }
  }
  return out
}

// Fresh ids for each call, so every test starts from new-1.
const opts = () => {
  let n = 0
  return { spaceId: 's2', name: 'Fresh', key: 'FRS', newId: () => `new-${++n}`, now: NOW }
}

describe('projectTemplateFrom', () => {
  test('keeps the setup and drops project-only state', () => {
    const tpl = projectTemplateFrom(source(), 'p1', 'Starter', false, 'tpl1', NOW)
    assert.equal(tpl.name, 'Starter')
    assert.equal(tpl.project.columns.length, 1)
    assert.equal(tpl.project.statuses.length, 5)
    assert.equal(tpl.automations.length, 1)
    assert.equal(tpl.triageRules.length, 1)
    assert.equal(tpl.project.views.length, 1)
    assert.deepEqual(tpl.project.milestones, [{ id: 'm1', name: 'Beta', date: '2026-05-01', done: false }])
    assert.deepEqual(tpl.project.widths, {})
    assert.equal(tpl.project.order, undefined)
    assert.deepEqual(tpl.project.updates, [])
  })

  test('starter issues are optional: none are kept without withIssues', () => {
    assert.deepEqual(projectTemplateFrom(source(), 'p1', 'Starter', false, 'tpl1', NOW).issues, [])
  })

  test('with withIssues, strips history and links that point outside the copied issues', () => {
    const [login, child] = projectTemplateFrom(source(), 'p1', 'Starter', true, 'tpl1', NOW).issues
    assert.deepEqual([login.comments, login.activity], [[], []])
    assert.deepEqual([login.favourite, login.firedAutomations, login.completedAt, login.triage], [undefined, undefined, undefined, undefined])
    assert.equal(login.milestoneId, undefined)
    assert.equal(login.cycleId, undefined)
    assert.deepEqual(login.relations, [{ type: 'related', targetId: 'i2' }])
    assert.equal(child.parentId, 'i1')
  })
})

describe('instantiateProjectTemplate', () => {
  test('a project created from a template shares no ids with the source', () => {
    const src = source()
    const made = instantiateProjectTemplate(projectTemplateFrom(src, 'p1', 'Starter', true, 'tpl1', NOW), opts())
    const before = idsIn({ p: src.projects, a: src.automations, t: src.triageRules, i: src.issues })
    const after = idsIn({ p: made.project, a: made.automations, t: made.triageRules, i: made.issues })
    assert.ok(before.size > 0)
    assert.deepEqual([...after].filter(id => before.has(id)), [])
  })

  test('sets the new space, name, key, status and issue numbers', () => {
    const made = instantiateProjectTemplate(projectTemplateFrom(source(), 'p1', 'Starter', true, 'tpl1', NOW), opts())
    assert.deepEqual([made.project.spaceId, made.project.name, made.project.key, made.project.status, made.project.initiativeId], ['s2', 'Fresh', 'FRS', 'planned', undefined])
    assert.deepEqual(made.issues.map(i => i.number), [1, 2])
    assert.equal(made.issues[0].createdAt, NOW)
  })

  test('status references, the status-keyed maps and the status values point at the new status ids', () => {
    const made = instantiateProjectTemplate(projectTemplateFrom(source(), 'p1', 'Starter', true, 'tpl1', NOW), opts())
    const statusId = (label: string) => made.project.statuses.find(s => s.label === label)?.id
    const [done, todo, inProgress] = ['Done', 'Todo', 'In Progress'].map(statusId)
    assert.deepEqual(made.automations[0].trigger, { type: 'status_changed', to: done })
    assert.deepEqual(made.automations[0].action, { type: 'set_status', status: todo })
    assert.deepEqual(made.triageRules[0].when.conditions[0], { key: 'status', op: 'is', value: todo })
    assert.deepEqual(made.triageRules[0].set, { status: inProgress, labels: ['done'] })
    assert.equal(made.project.views[0].filter.conditions[0].value, done)
    assert.equal(made.project.views[0].groupBy, 'status')
    assert.deepEqual(made.project.wipLimits, { [todo!]: 3 })
    assert.equal(made.issues[0].status, done)
    assert.equal(made.issues[1].status, todo)
  })

  test('column keys, option values and milestone and issue links are re-keyed', () => {
    const made = instantiateProjectTemplate(projectTemplateFrom(source(), 'p1', 'Starter', true, 'tpl1', NOW), opts())
    const col = made.project.columns[0]
    assert.deepEqual(made.project.hiddenColumns, [col.id])
    assert.deepEqual(made.project.views[0].hidden, [col.id])
    assert.deepEqual(made.issues[0].values, { [col.id]: col.options![0].id })
    assert.equal(made.issues[1].parentId, made.issues[0].id)
    assert.equal(made.issues[0].relations[0].targetId, made.issues[1].id)
    assert.notEqual(made.project.milestones[0].id, 'm1')
    assert.notEqual(made.project.views[0].id, 'v1')
  })

  test('label names are not ids: a label or text value that reads like a status id is kept', () => {
    const made = instantiateProjectTemplate(projectTemplateFrom(source(), 'p1', 'Starter', true, 'tpl1', NOW), opts())
    assert.deepEqual(made.issues[0].labels, ['done'])
    assert.deepEqual(made.triageRules[0].set.labels, ['done'])
  })

  test('addProjectFromTemplate appends the project and its contents in one action', () => {
    const base = source()
    const made = instantiateProjectTemplate(projectTemplateFrom(base, 'p1', 'Starter', true, 'tpl1', NOW), opts())
    const out = reducer(base, { type: 'addProjectFromTemplate', ...made })
    assert.deepEqual(out.projects.map(p => p.id).slice(1), [made.project.id])
    assert.equal(out.automations.length, 2)
    assert.equal(out.triageRules.length, 2)
    assert.deepEqual(out.issues.slice(2).map(i => i.id), made.issues.map(i => i.id))
  })

  test('without starter issues, the reducer adds the project alone', () => {
    const base = source()
    const made = instantiateProjectTemplate(projectTemplateFrom(base, 'p1', 'Starter', false, 'tpl1', NOW), opts())
    const out = reducer(base, { type: 'addProjectFromTemplate', ...made })
    assert.equal(out.projects.length, 2)
    assert.equal(out.issues.length, base.issues.length)
  })
})
