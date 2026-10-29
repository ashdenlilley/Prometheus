import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { RECIPES, recipeAutomation, type Blank } from '../../src/shared/recipes'
import { createIssue, reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, AutomationAction, AutomationTrigger } from '../../src/shared/types'

const TRIGGER_TYPES: AutomationTrigger['type'][] = [
  'status_changed',
  'priority_changed',
  'assignee_changed',
  'due_passed',
  'column_changed',
  'project_status_changed',
  'cycle_started',
  'cycle_ended',
  'initiative_status_changed'
]
const ACTION_TYPES: AutomationAction['type'][] = ['set_status', 'set_priority', 'set_assignee', 'add_label', 'move_to_cycle', 'create_issue', 'notify']

const data = (): AppData => ({
  ...emptyData(),
  projects: [
    blankProject({ id: 'p1', spaceId: 's1', name: 'Home', key: 'HOME', color: '#000000' }),
    blankProject({ id: 'p2', spaceId: 's1', name: 'Work', key: 'WORK', color: '#000000' })
  ]
})

const ANSWERS: Partial<Record<Blank, string>> = { status: 'todo', priority: '2', label: 'urgent-ish', message: 'Hello', project: 'p2' }

describe('recipes', () => {
  test('each blank is named in its sentence', () => {
    for (const r of RECIPES) {
      for (const b of r.blanks) assert.ok(r.sentence.includes(`{${b}}`), `${r.id} is missing {${b}}`)
    }
  })

  for (const [label, answers] of [
    ['without answers', {}],
    ['with answers', ANSWERS]
  ] as const) {
    test(`every recipe builds a valid automation ${label}`, () => {
      const d = data()
      const project = d.projects[0]
      for (const r of RECIPES) {
        const a = recipeAutomation(r, project, answers, `${r.id}-rule`)
        assert.equal(a.projectId, 'p1', r.id)
        assert.equal(a.enabled, true, r.id)
        assert.ok(a.createdAt, r.id)
        assert.ok(TRIGGER_TYPES.includes(a.trigger.type), `${r.id} trigger ${a.trigger.type}`)
        assert.ok(ACTION_TYPES.includes(a.action.type), `${r.id} action ${a.action.type}`)
        if (a.trigger.type === 'status_changed') {
          const to = a.trigger.to
          assert.ok(project.statuses.some(s => s.id === to), `${r.id} status ${to}`)
        }
        if (a.action.type === 'create_issue') {
          const target = a.action.projectId
          assert.ok(!target || d.projects.some(p => p.id === target), `${r.id} target project`)
        }
      }
    })
  }

  test('a recipe with answers uses them, and without answers uses the defaults', () => {
    const project = data().projects[0]
    const withAnswers = RECIPES.find(r => r.id === 'status-followup')!
    assert.deepEqual(recipeAutomation(withAnswers, project, ANSWERS, 'x').action, { type: 'create_issue', title: 'Follow up', projectId: 'p2' })
    assert.deepEqual(recipeAutomation(withAnswers, project, {}, 'x').action, { type: 'create_issue', title: 'Follow up', projectId: 'p1' })
    assert.deepEqual(recipeAutomation(withAnswers, project, {}, 'x').trigger, { type: 'status_changed', to: 'done' })
  })

  test('an added recipe automation fires through the reducer', () => {
    const d = data()
    const issue = createIssue(d, 'p1', 'Ship it', { id: 'i1', number: 1 })
    const recipe = RECIPES.find(r => r.id === 'status-notify')!
    const added = reducer({ ...d, issues: [issue] }, { type: 'addAutomation', automation: recipeAutomation(recipe, d.projects[0], {}, 'r1') })
    assert.equal(added.automations.length, 1)
    const s = reducer(added, { type: 'patchIssue', id: 'i1', patch: { status: 'done' } })
    assert.deepEqual(
      s.notifications.map(n => n.text),
      ['Status changed (Notify on status)']
    )
  })
})
