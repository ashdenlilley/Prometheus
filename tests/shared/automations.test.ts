import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createIssue, reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { Automation, AutomationAction, AutomationTrigger, AppData, Cycle, Project } from '../../src/shared/types'

const proj = (id: string, spaceId: string, extra: Partial<Project> = {}) => blankProject({ id, spaceId, name: id, key: id.toUpperCase(), color: '#000000', ...extra })

// Two projects in space s1, one project in space s2. The source issue i1 lives in p1.
const base = (): AppData => ({
  ...emptyData(),
  projects: [proj('p1', 's1'), proj('p2', 's1'), proj('p3', 's2')],
  issues: [createIssue(emptyData(), 'p1', 'Source', { id: 'i1', number: 1 })]
})

const rule = (trigger: AutomationTrigger, action: AutomationAction, patch: Partial<Automation> = {}): Automation => ({
  id: 'a1',
  projectId: 'p1',
  name: 'Rule',
  enabled: true,
  trigger,
  action,
  ...patch
})

const withRules = (s: AppData, ...automations: Automation[]): AppData => ({ ...s, automations })
const onDone: AutomationTrigger = { type: 'status_changed', to: 'done' }
const finish = (s: AppData) => reducer(s, { type: 'patchIssue', id: 'i1', patch: { status: 'done' } })
const notes = (s: AppData) => s.notifications.map(n => n.text)

describe('create_issue across projects', () => {
  test('creates the issue in the target project with a related relation and its default status', () => {
    const s = finish(withRules(base(), rule(onDone, { type: 'create_issue', title: 'Follow up', projectId: 'p2', status: 'nope' })))
    const child = s.issues.find(i => i.projectId === 'p2')
    assert.ok(child)
    assert.equal(child.title, 'Follow up')
    assert.equal(child.status, 'backlog')
    assert.equal(child.parentId, undefined)
    assert.deepEqual(child.relations, [{ type: 'related', targetId: 'i1' }])
  })

  test('uses the action status when the target project has it', () => {
    const s = finish(withRules(base(), rule(onDone, { type: 'create_issue', title: 'Follow up', projectId: 'p2', status: 'todo' })))
    assert.equal(s.issues.find(i => i.projectId === 'p2')?.status, 'todo')
  })

  test('without a projectId it is a sub-issue of the trigger issue', () => {
    const s = finish(withRules(base(), rule(onDone, { type: 'create_issue', title: 'Child' })))
    const child = s.issues.find(i => i.title === 'Child')
    assert.equal(child?.projectId, 'p1')
    assert.equal(child?.parentId, 'i1')
    assert.deepEqual(child?.relations, [])
  })

  test('a target in another space disables the automation and says why', () => {
    const s = finish(withRules(base(), rule(onDone, { type: 'create_issue', title: 'Nope', projectId: 'p3' })))
    assert.equal(s.issues.some(i => i.title === 'Nope'), false)
    assert.equal(s.automations[0].enabled, false)
    assert.deepEqual(notes(s), ['Automation "Rule" was disabled: its target project no longer exists'])
  })

  test('a missing target disables the automation without crashing', () => {
    const s = finish(withRules(base(), rule(onDone, { type: 'create_issue', title: 'Nope', projectId: 'gone' })))
    assert.equal(s.automations[0].enabled, false)
    assert.equal(s.issues.length, 1)
    assert.equal(s.notifications.length, 1)
  })

  test('deleting a project disables automations in other projects that create issues there', () => {
    const s = reducer(
      withRules(
        base(),
        rule(onDone, { type: 'create_issue', title: 'x', projectId: 'p2' }, { id: 'a1' }),
        rule(onDone, { type: 'notify', message: 'keep' }, { id: 'a2' }),
        rule(onDone, { type: 'create_issue', title: 'y', projectId: 'p2' }, { id: 'a3', projectId: 'p3' }),
        rule(onDone, { type: 'create_issue', title: 'z', projectId: 'p2' }, { id: 'a4', projectId: 'p2' })
      ),
      { type: 'deleteProject', id: 'p2' }
    )
    assert.deepEqual(
      s.automations.map(a => [a.id, a.enabled]),
      [
        ['a1', false],
        ['a2', true],
        ['a3', false]
      ]
    )
  })
})

describe('depth guard', () => {
  test('a set_status action does not chain into another status_changed rule', () => {
    const s = finish(
      withRules(
        base(),
        rule(onDone, { type: 'set_status', status: 'todo' }, { id: 'a1' }),
        rule({ type: 'status_changed', to: 'todo' }, { type: 'add_label', label: 'chained' }, { id: 'a2' })
      )
    )
    assert.equal(s.issues[0].status, 'todo')
    assert.deepEqual(s.issues[0].labels, [])
  })

  test('a column_changed rule runs once per change, and its own action does not re-trigger column rules', () => {
    const base0 = withRules(
      base(),
      rule({ type: 'column_changed', columnId: 'c1' }, { type: 'set_status', status: 'todo' }, { id: 'a1' }),
      rule({ type: 'column_changed', columnId: 'c1' }, { type: 'notify', message: 'Changed' }, { id: 'a2' })
    )
    const s = reducer(base0, { type: 'patchIssue', id: 'i1', patch: { values: { c1: 'yes' } } })
    assert.equal(s.issues[0].status, 'todo')
    assert.deepEqual(notes(s), ['Changed (Rule)'])
  })
})

describe('column_changed', () => {
  const colRule = (to?: string) => withRules(base(), rule({ type: 'column_changed', columnId: 'c1', to }, { type: 'notify', message: 'Changed' }))
  const setValue = (s: AppData, value: unknown) => reducer(s, { type: 'patchIssue', id: 'i1', patch: { values: { c1: value as string } } })

  test('with no value it fires on any change to the column, not on other fields', () => {
    const s = colRule()
    assert.equal(notes(setValue(s, 'x')).length, 1)
    assert.equal(notes(reducer(s, { type: 'patchIssue', id: 'i1', patch: { title: 'Renamed' } })).length, 0)
  })

  test('with a value it fires only when the new value matches', () => {
    const s = colRule('yes')
    assert.equal(notes(setValue(s, 'no')).length, 0)
    assert.equal(notes(setValue(s, 'yes')).length, 1)
    assert.equal(notes(setValue(s, ['a', 'yes'])).length, 1)
    assert.equal(notes(setValue(s, ['a', 'b'])).length, 0)
  })
})

describe('project status and initiative status', () => {
  test('a project status change runs its project_status_changed rule on unfinished issues only', () => {
    const s0 = withRules(
      base(),
      rule({ type: 'project_status_changed', to: 'completed' }, { type: 'set_status', status: 'done' })
    )
    const s1 = { ...s0, issues: [...s0.issues, createIssue(s0, 'p1', 'Gone', { id: 'i2', status: 'canceled' })] }
    const s = reducer(s1, { type: 'patchProject', id: 'p1', patch: { status: 'completed' } })
    assert.equal(s.issues.find(i => i.id === 'i1')?.status, 'done')
    assert.equal(s.issues.find(i => i.id === 'i2')?.status, 'canceled')
  })

  test('a project status rule with a different target does not fire', () => {
    const s0 = withRules(base(), rule({ type: 'project_status_changed', to: 'paused' }, { type: 'notify', message: 'Paused' }))
    assert.deepEqual(notes(reducer(s0, { type: 'patchProject', id: 'p1', patch: { status: 'completed' } })), [])
    assert.deepEqual(notes(reducer(s0, { type: 'patchProject', id: 'p1', patch: { status: 'paused' } })), ['Paused (Rule)'])
  })

  test('an initiative status change runs rules of projects in that initiative only', () => {
    const s0: AppData = {
      ...withRules(
        base(),
        rule({ type: 'initiative_status_changed', to: 'done' }, { type: 'set_priority', priority: 2 }, { id: 'a1', projectId: 'p1' }),
        rule({ type: 'initiative_status_changed', to: 'done' }, { type: 'set_priority', priority: 2 }, { id: 'a2', projectId: 'p2' })
      ),
      initiatives: [{ id: 'init1', spaceId: 's1', name: 'Launch', color: '#000000', status: 'active' }],
      projects: [proj('p1', 's1', { initiativeId: 'init1' }), proj('p2', 's1')]
    }
    const s = reducer(s0, { type: 'patchInitiative', id: 'init1', patch: { status: 'done' } })
    assert.equal(s.issues[0].priority, 2)
  })
})

describe('cycle_started and cycle_ended', () => {
  const cycle = (patch: Partial<Cycle>): Cycle => ({ id: 'c1', projectId: 'p1', name: 'Cycle 1', startDate: '2026-11-01', endDate: '2026-11-14', ...patch })
  const cycleRules = (s: AppData, trigger: AutomationTrigger, createdAt = '2026-10-20T00:00:00.000Z') =>
    withRules(s, rule(trigger, { type: 'notify', message: 'Cycle' }, { createdAt }))

  test('cycle_started fires once when the cycle starts, and again on later ticks it does not repeat', () => {
    const s0 = { ...cycleRules(base(), { type: 'cycle_started' }), cycles: [cycle({})] }
    const before = reducer(s0, { type: 'tick', today: '2026-10-31' })
    assert.deepEqual(notes(before), [])
    const once = reducer(s0, { type: 'tick', today: '2026-11-01' })
    const twice = reducer(once, { type: 'tick', today: '2026-11-02' })
    assert.deepEqual(notes(once), ['Cycle (Rule)'])
    assert.deepEqual(notes(twice), ['Cycle (Rule)'])
    assert.deepEqual(twice.cycles[0].firedAutomations, ['a1:started'])
  })

  test('cycle_ended fires once after the end date, not on the end date itself', () => {
    const s0 = { ...cycleRules(base(), { type: 'cycle_ended' }), cycles: [cycle({ startDate: '2026-10-15', endDate: '2026-10-28' })] }
    assert.deepEqual(notes(reducer(s0, { type: 'tick', today: '2026-10-28' })), [])
    const once = reducer(s0, { type: 'tick', today: '2026-10-29' })
    const twice = reducer(once, { type: 'tick', today: '2026-10-30' })
    assert.deepEqual(notes(once), ['Cycle (Rule)'])
    assert.deepEqual(notes(twice), ['Cycle (Rule)'])
  })

  test('cycles that ended before the rule existed do not fire', () => {
    const s0 = {
      ...cycleRules(base(), { type: 'cycle_ended' }),
      cycles: [cycle({ startDate: '2026-09-27', endDate: '2026-10-10' })]
    }
    assert.deepEqual(notes(reducer(s0, { type: 'tick', today: '2026-10-29' })), [])
  })

  test('a cycle already running when the rule was made does not fire cycle_started, but fires cycle_ended later', () => {
    const started = { ...cycleRules(base(), { type: 'cycle_started' }), cycles: [cycle({ startDate: '2026-10-15', endDate: '2026-11-05' })] }
    assert.deepEqual(notes(reducer(started, { type: 'tick', today: '2026-10-29' })), [])
    const ended = { ...cycleRules(base(), { type: 'cycle_ended' }), cycles: [cycle({ startDate: '2026-10-15', endDate: '2026-11-05' })] }
    assert.equal(notes(reducer(ended, { type: 'tick', today: '2026-11-06' })).length, 1)
  })

  test('a cycle start runs the rule on unfinished issues of that cycle only', () => {
    const s0 = {
      ...cycleRules(base(), { type: 'cycle_started' }),
      cycles: [cycle({})],
      issues: [
        createIssue(emptyData(), 'p1', 'In cycle', { id: 'i1', number: 1, cycleId: 'c1' }),
        createIssue(emptyData(), 'p1', 'Finished', { id: 'i2', number: 2, cycleId: 'c1', status: 'done' }),
        createIssue(emptyData(), 'p1', 'Outside', { id: 'i3', number: 3, status: 'backlog' })
      ]
    }
    const automations = s0.automations.map(a => ({ ...a, action: { type: 'set_priority' as const, priority: 1 } }))
    const s = reducer({ ...s0, automations }, { type: 'tick', today: '2026-11-01' })
    assert.deepEqual(
      s.issues.map(i => i.priority),
      [1, 0, 0]
    )
  })
})

describe('object triggers do not fire from issue changes', () => {
  test('a project status rule is not run by an issue update', () => {
    const s = finish(withRules(base(), rule({ type: 'project_status_changed' }, { type: 'notify', message: 'Nope' })))
    assert.deepEqual(notes(s), [])
  })
})
