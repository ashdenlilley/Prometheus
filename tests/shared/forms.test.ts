import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { submissionToIssue, validateForm } from '../../src/shared/forms'
import { reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, Column, IntakeForm } from '../../src/shared/types'

const col = (id: string, type: Column['type'], name = id): Column => ({ id, name, type })

const project = blankProject({
  id: 'p1',
  spaceId: 's1',
  name: 'Support',
  key: 'SUP',
  color: '#000000',
  columns: [col('sev', 'number', 'Severity'), col('area', 'dropdown', 'Area'), col('calc', 'formula', 'Calc')]
})

const form = (fields: IntakeForm['fields'], labels?: string[]): IntakeForm => ({ id: 'f1', name: 'Bug report', fields, labels })

const base = { id: 'i1', number: 7, now: '2026-10-29T00:00:00.000Z' }

describe('validateForm', () => {
  test('passes a form with title and known fields', () => {
    assert.deepEqual(validateForm(form([{ key: 'title' }, { key: 'sev' }, { key: 'area' }]), project), [])
  })

  test('reports unknown keys, duplicate keys and missing title', () => {
    const errors = validateForm(form([{ key: 'title' }, { key: 'nope' }, { key: 'title' }]), project)
    assert.deepEqual(errors, ['Unknown field "nope"', 'Duplicate field "title"'])
    assert.deepEqual(validateForm(form([{ key: 'description' }]), project), ['Form needs a Title field'])
  })

  test('rejects column types that cannot be typed into', () => {
    assert.deepEqual(validateForm(form([{ key: 'title' }, { key: 'calc' }]), project), ['Column "Calc" (formula) cannot be filled in a form'])
  })
})

describe('submissionToIssue', () => {
  test('requires the title and any required field', () => {
    const f = form([{ key: 'title' }, { key: 'sev', label: 'Severity', required: true }])
    assert.deepEqual(submissionToIssue(f, project, { title: '  ' }, base).errors, ['Title is required', 'Severity is required'])
  })

  test('maps fixed fields and column values, adds form labels, and sets triage', () => {
    const f = form(
      [{ key: 'title' }, { key: 'description' }, { key: 'priority' }, { key: 'labels' }, { key: 'dueDate' }, { key: 'sev' }, { key: 'area' }],
      ['intake']
    )
    const { issue, errors } = submissionToIssue(
      f,
      project,
      { title: ' Login fails ', description: 'Steps', priority: 2, labels: 'auth, web', dueDate: '2026-11-01', sev: '3', area: ['a1'] },
      base
    )
    assert.deepEqual(errors, [])
    assert.ok(issue)
    assert.equal(issue.id, 'i1')
    assert.equal(issue.number, 7)
    assert.equal(issue.projectId, 'p1')
    assert.equal(issue.title, 'Login fails')
    assert.equal(issue.description, 'Steps')
    assert.equal(issue.priority, 2)
    assert.deepEqual(issue.labels, ['intake', 'auth', 'web'])
    assert.equal(issue.dueDate, '2026-11-01')
    assert.deepEqual(issue.values, { sev: 3, area: ['a1'] })
    assert.equal(issue.status, project.statuses.find(s => s.category === 'unstarted')?.id)
    assert.equal(issue.triage, true)
  })

  test('rejects a priority outside 0 to 4', () => {
    const { issue, errors } = submissionToIssue(form([{ key: 'title' }, { key: 'priority' }]), project, { title: 'x', priority: 9 }, base)
    assert.equal(issue, undefined)
    assert.deepEqual(errors, ['Priority must be 0 (none) to 4 (low)'])
  })

  test('returns the validation errors without an issue for a broken form', () => {
    const out = submissionToIssue(form([{ key: 'calc' }]), project, {}, base)
    assert.equal(out.issue, undefined)
    assert.equal(out.errors.length, 2)
  })
})

describe('addIssue with triage rules', () => {
  test('applies a matching triage rule to a submitted item', () => {
    const data: AppData = {
      ...emptyData(),
      projects: [project],
      triageRules: [
        {
          id: 'r1',
          projectId: 'p1',
          name: 'Logins are urgent',
          enabled: true,
          when: { match: 'all', conditions: [{ key: 'name', op: 'contains', value: 'login' }] },
          set: { priority: 1 }
        }
      ]
    }
    const { issue } = submissionToIssue(form([{ key: 'title' }]), project, { title: 'Login fails' }, base)
    assert.ok(issue)
    const next = reducer(data, { type: 'addIssue', issue })
    assert.equal(next.issues[0].priority, 1)
    assert.equal(next.issues[0].triage, true)
  })
})
