import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildImport, mapPriority, parseAsanaCsv, parseAsanaJson, parseJiraCsv, unknownStatuses } from '../../src/shared/importers'
import { blankProject } from '../../src/shared/seed'

const JIRA = [
  'Summary,Issue key,Issue id,Parent id,Status,Priority,Assignee,Labels,Labels,Due date,Custom field (Story Points),Description',
  'Login fails,SUP-1,101,,To Do,Highest,Ada,auth,web,2026-11-01,3,"Steps, in order"',
  'Fix SSO,SUP-2,102,101,Done,Low,,,,,,'
].join('\n')

const ASANA_CSV = [
  'Task ID,Name,Section/Column,Assignee,Due Date,Tags,Notes,Parent task,Completed At',
  'a1,Plan release,Backlog,Ada,2026-11-02,"ops, q4",Ship it,,',
  'a2,Write notes,Doing,,,,,Plan release,2026-10-20'
].join('\n')

const ASANA_JSON = JSON.stringify({
  data: [
    {
      gid: 'g1',
      name: 'Plan release',
      notes: 'Ship it',
      assignee: { name: 'Ada' },
      due_on: '2026-11-02',
      completed: false,
      tags: [{ name: 'ops' }],
      parent: null,
      memberships: [{ section: { name: 'Backlog' } }]
    },
    { gid: 'g2', name: 'Write notes', completed: true, tags: [], parent: { gid: 'g1' }, memberships: [] }
  ]
})

const project = blankProject({ id: 'p1', spaceId: 's1', name: 'Support', key: 'SUP', color: '#000000' })

describe('parseJiraCsv', () => {
  test('reads fields, collects every repeated Labels column, and maps priority and estimate', () => {
    const [a, b] = parseJiraCsv(JIRA)
    assert.equal(a.extId, '101')
    assert.equal(a.title, 'Login fails')
    assert.equal(a.status, 'To Do')
    assert.equal(a.priority, 1)
    assert.equal(a.assignee, 'Ada')
    assert.deepEqual(a.labels, ['auth', 'web'])
    assert.equal(a.dueDate, '2026-11-01')
    assert.equal(a.estimate, 3)
    assert.equal(a.description, 'Steps, in order')
    assert.equal(a.done, false)
    assert.equal(b.parentExtId, '101')
    assert.equal(b.priority, 4)
    assert.equal(b.done, true)
  })
})

describe('parseAsanaCsv', () => {
  test('uses the section as status, splits tags, and resolves the parent name to its task id', () => {
    const [a, b] = parseAsanaCsv(ASANA_CSV)
    assert.equal(a.extId, 'a1')
    assert.equal(a.status, 'Backlog')
    assert.deepEqual(a.labels, ['ops', 'q4'])
    assert.equal(a.description, 'Ship it')
    assert.equal(a.done, false)
    assert.equal(b.parentExtId, 'a1')
    assert.equal(b.done, true)
  })
})

describe('parseAsanaJson', () => {
  test('reads the data array', () => {
    const [a, b] = parseAsanaJson(ASANA_JSON)
    assert.equal(a.extId, 'g1')
    assert.equal(a.assignee, 'Ada')
    assert.equal(a.dueDate, '2026-11-02')
    assert.deepEqual(a.labels, ['ops'])
    assert.equal(a.status, 'Backlog')
    assert.equal(b.parentExtId, 'g1')
    assert.equal(b.done, true)
  })
})

describe('mapPriority', () => {
  test('maps Jira names to the app priority index', () => {
    assert.deepEqual(['Highest', 'Blocker', 'Critical', 'High', 'Medium', 'Low', 'Lowest', 'Other'].map(mapPriority), [1, 1, 1, 2, 3, 4, 4, 0])
  })
})

describe('unknownStatuses', () => {
  test('lists status names that match no project status label, ignoring case', () => {
    const rows = parseJiraCsv(JIRA).concat(parseAsanaCsv(ASANA_CSV))
    // Backlog and Done match project labels; "To Do" (vs Todo) and "Doing" do not.
    assert.deepEqual(unknownStatuses(rows, project), ['To Do', 'Doing'])
  })

  test('does not list a status that matches a label in a different case', () => {
    const rows = [{ extId: '1', title: 'x', status: 'TODO', labels: [] }]
    assert.deepEqual(unknownStatuses(rows, project), [])
  })
})

describe('buildImport', () => {
  let n = 0
  const base = { newId: () => `new-${++n}`, startNumber: 10, now: '2026-10-29T00:00:00.000Z' }

  test('links parents by extId, maps statuses, and sends done rows to the completed status', () => {
    n = 0
    const rows = parseJiraCsv(JIRA)
    const [a, b] = buildImport(rows, project, { 'To Do': project.statuses[1].id }, base)
    assert.equal(a.id, 'new-1')
    assert.equal(a.number, 10)
    assert.equal(a.status, project.statuses[1].id)
    assert.equal(a.priority, 1)
    assert.equal(a.projectId, 'p1')
    assert.equal(b.id, 'new-2')
    assert.equal(b.number, 11)
    assert.equal(b.parentId, 'new-1')
    assert.equal(b.status, project.statuses.find(s => s.category === 'completed')?.id)
  })

  test('drops a parent link whose parent is not in the import', () => {
    const [only] = buildImport([{ extId: 'x', title: 'Orphan', labels: [], parentExtId: 'missing' }], project, {}, base)
    assert.equal(only.parentId, undefined)
  })

  test('gives duplicate extIds separate ids', () => {
    n = 0
    const out = buildImport([{ extId: 'd', title: 'One', labels: [] }, { extId: 'd', title: 'Two', labels: [] }], project, {}, base)
    assert.notEqual(out[0].id, out[1].id)
  })
})
