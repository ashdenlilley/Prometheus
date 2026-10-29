import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { reducer, createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import { emptyHistory, withUndo } from '../../src/shared/history'
import { applyOps, type Op } from '../../src/shared/sync'
import { migrate } from '../../src/shared/migrate'
import {
  backlinks,
  docBytes,
  docConflictCopy,
  docFromTemplate,
  DOC_MAX_BYTES,
  editBody,
  findMentions,
  newDoc,
  searchDocs
} from '../../src/shared/docs'
import type { AppData, Doc } from '../../src/shared/types'

const doc = (id: string, patch: Partial<Doc> = {}): Doc => ({
  id,
  spaceId: 's1',
  title: `Doc ${id}`,
  body: '',
  createdAt: 1,
  updatedAt: 1,
  ...patch
})

// Space s1 holds project OS (key OS) with issue 354 (id i354) and project T with issue 1 (id t1).
const base = (): AppData => ({
  ...emptyData(),
  spaces: [{ id: 's1', name: 'Work', color: '#000000' }],
  projects: [
    blankProject({ id: 'p1', spaceId: 's1', name: 'Core', key: 'OS', color: '#000000' }),
    blankProject({ id: 'p2', spaceId: 's1', name: 'Other', key: 'T', color: '#000000' })
  ],
  issues: [createIssue(emptyData(), 'p1', 'Docs', { id: 'i354', number: 354 }), createIssue(emptyData(), 'p2', 'Other', { id: 't1', number: 1 })]
})

describe('docs: reducer', () => {
  test('create, rename, delete, then undo the delete', () => {
    // Each step ticks the clock by 1s, so the undo gesture window never merges two steps.
    let t = 0
    const step = withUndo(reducer, () => (t += 1000))
    let st = { data: base(), history: emptyHistory() }

    const d = newDoc({ id: 'd1', spaceId: 's1', title: 'Spec' })
    st = step(st, { type: 'addDoc', doc: d })
    assert.equal(st.data.docs?.length, 1)

    st = step(st, { type: 'patchDoc', id: 'd1', patch: { title: 'Spec v2' } })
    assert.equal(st.data.docs?.[0].title, 'Spec v2')
    assert.ok(st.data.docs![0].updatedAt >= d.updatedAt)

    st = step(st, { type: 'deleteDoc', id: 'd1' })
    assert.equal(st.data.docs?.length, 0)
    st = step(st, { type: 'undo' })
    assert.equal(st.data.docs?.[0].title, 'Spec v2')
  })

  test('duplicate copies body under a new id', () => {
    const d = newDoc({ id: 'd1', spaceId: 's1', title: 'Spec', body: 'hello' })
    const out = reducer({ ...base(), docs: [d] }, { type: 'duplicateDoc', id: 'd1', newId: 'd2' })
    const copy = out.docs!.find(x => x.id === 'd2')!
    assert.equal(copy.body, 'hello')
    assert.equal(copy.title, 'Spec (copy)')
    assert.equal(out.docs!.length, 2)
  })

  test('template round trip: save as template, then create a doc from it', () => {
    const d = newDoc({ id: 'd1', spaceId: 's1', projectId: 'p1', title: 'Spec', body: '# Goal' })
    const withTpl = reducer({ ...base(), docs: [d] }, { type: 'saveDocAsTemplate', id: 'd1', newId: 'tpl' })
    const tpl = withTpl.docs!.find(x => x.id === 'tpl')!
    assert.equal(tpl.template, true)

    const fromTpl = docFromTemplate(tpl, { id: 'd3', spaceId: 's1', projectId: 'p2' })
    assert.equal(fromTpl.id, 'd3')
    assert.equal(fromTpl.projectId, 'p2')
    assert.equal(fromTpl.title, 'Spec')
    assert.equal(fromTpl.body, '# Goal')
    assert.equal(fromTpl.template, false)
  })

  test('deleting a project or space removes its docs', () => {
    const docs = [
      newDoc({ id: 'a', spaceId: 's1', projectId: 'p1', title: 'A' }),
      newDoc({ id: 'b', spaceId: 's1', projectId: 'p2', title: 'B' })
    ]
    const noProject = reducer({ ...base(), docs }, { type: 'deleteProject', id: 'p1' })
    assert.deepEqual(noProject.docs?.map(d => d.id), ['b'])
    const noSpace = reducer({ ...base(), docs }, { type: 'deleteSpace', id: 's1' })
    assert.deepEqual(noSpace.docs, [])
  })
})

describe('docs: mentions and backlinks', () => {
  test('finds KEY-N mentions and ignores unknown keys and code fences', () => {
    const data = base()
    const body = 'See OS-354 and ZZ-9.\n```\nOS-354 in code\n```\n~~~\nT-1\n~~~\nT-1 is here'
    assert.deepEqual(findMentions(body, data), ['i354', 't1'])
    assert.deepEqual(findMentions('```\nOS-354\n```', data), [])
    assert.deepEqual(findMentions('NOTOS-354 and aOS-354', data), [])
  })

  test('backlinks skip archived docs and templates', () => {
    const data: AppData = {
      ...base(),
      docs: [
        doc('live', { body: 'Relates to OS-354' }),
        doc('old', { body: 'OS-354', archivedAt: 5 }),
        doc('tpl', { body: 'OS-354', template: true }),
        doc('other', { body: 'nothing here' })
      ]
    }
    assert.deepEqual(backlinks('i354', data).map(d => d.id), ['live'])
    assert.deepEqual(backlinks('t1', data), [])
  })
})

describe('docs: size and search', () => {
  test('docBytes counts UTF-8 bytes', () => {
    assert.equal(docBytes('abc'), 3)
    assert.equal(docBytes('é'), 2)
  })

  test('editBody throws over the limit and accepts exactly the limit', () => {
    const d = doc('d1')
    assert.throws(() => editBody(d, 'x'.repeat(DOC_MAX_BYTES + 1), 'S'), /over/)
    assert.equal(editBody(d, 'x'.repeat(DOC_MAX_BYTES), 'S').body.length, DOC_MAX_BYTES)
  })

  test('searchDocs matches title and body, title matches first, case-insensitive', () => {
    const data: AppData = {
      ...base(),
      docs: [doc('body-hit', { title: 'Other', body: 'the PLAN is here' }), doc('title-hit', { title: 'Plan', body: '' }), doc('gone', { title: 'Plan', archivedAt: 2 })]
    }
    assert.deepEqual(searchDocs(data, 'plan').map(d => d.id), ['title-hit', 'body-hit'])
    assert.deepEqual(searchDocs(data, '  '), [])
  })
})

describe('docs: sync conflicts', () => {
  test('same-session successive edits are not a conflict', () => {
    const e1 = editBody(doc('d'), 'one', 'S')
    const e2 = editBody(e1, 'two', 'S')
    const incoming = { body: e2.body, rev: e2.rev, baseRev: e2.baseRev, revBy: e2.revBy }
    assert.equal(docConflictCopy(e1, incoming, true), null)
    assert.equal(docConflictCopy(e1, incoming, false), null)
  })

  test('edit made on top of a remote edit is not a conflict', () => {
    const remote = editBody(doc('d'), 'remote', 'B')
    const mine = editBody(remote, 'mine', 'A')
    assert.equal(docConflictCopy(remote, { body: mine.body, rev: mine.rev, baseRev: mine.baseRev, revBy: mine.revBy }, true), null)
  })

  test('both directions build the same conflicted copy', () => {
    const a = editBody(doc('d', { title: 'Spec' }), 'from A', 'A', 1000)
    const b = editBody(doc('d', { title: 'Spec' }), 'from B', 'B', 2000)
    const fields = (x: Doc) => ({ body: x.body, rev: x.rev, baseRev: x.baseRev, revBy: x.revBy, updatedAt: x.updatedAt })

    // Device A holds its own edit and receives B's. B wins by the later clock.
    const onA = docConflictCopy(a, fields(b), true)
    // Device B holds its own edit and receives A's. A loses, so the incoming side is the copy.
    const onB = docConflictCopy(b, fields(a), false)

    assert.ok(onA && onB)
    assert.equal(onA.id, `d~${a.rev}`)
    assert.deepEqual(onA, onB)
    assert.equal(onA.body, 'from A')
    assert.equal(onA.title, 'Spec (conflicted copy)')
    assert.equal(onA.conflictOf, 'd')
  })

  test('applyOps keeps the later body and adds the same conflicted copy on either device', () => {
    const hlc = (ms: number, dev: string) => `${String(ms).padStart(15, '0')}.000000.${dev}`
    const a = editBody(doc('d', { title: 'Spec' }), 'from A', 'A', 1000)
    const b = editBody(doc('d', { title: 'Spec' }), 'from B', 'B', 2000)
    const opOf = (x: Doc, h: string): Op => ({
      hlc: h,
      table: 'docs',
      id: 'd',
      set: { body: x.body, rev: x.rev, baseRev: x.baseRev, revBy: x.revBy, updatedAt: x.updatedAt }
    })
    const start = { ...base(), docs: [doc('d', { title: 'Spec' })] }
    const opA = opOf(a, hlc(1000, 'A'))
    const opB = opOf(b, hlc(2000, 'B'))

    const clocksA = new Map<string, string>()
    const onA = applyOps(applyOps(start, [opA], clocksA).data, [opB], clocksA).data
    const clocksB = new Map<string, string>()
    const onB = applyOps(applyOps(start, [opB], clocksB).data, [opA], clocksB).data

    for (const out of [onA, onB]) {
      const winner = out.docs!.find(d => d.id === 'd')!
      assert.equal(winner.body, 'from B')
      const copies = out.docs!.filter(d => d.conflictOf === 'd')
      assert.equal(copies.length, 1)
      assert.equal(copies[0].id, `d~${a.rev}`)
      assert.equal(copies[0].body, 'from A')
    }
    assert.deepEqual(onA.docs!.find(d => d.conflictOf)!, onB.docs!.find(d => d.conflictOf)!)
  })
})

describe('docs: migrate', () => {
  test('a legacy file without docs gets an empty docs array', () => {
    const legacy = { version: 3, spaces: [], projects: [], issues: [] }
    assert.deepEqual(migrate(legacy).docs, [])
  })

  test('a version 4 file without docs still loads, and the reducer treats docs as empty', () => {
    const v4 = emptyData() as Partial<AppData>
    delete v4.docs
    const out = reducer(migrate(v4), { type: 'addDoc', doc: newDoc({ id: 'd1', spaceId: 's1', title: 'Spec' }) })
    assert.deepEqual(out.docs?.map(d => d.id), ['d1'])
  })
})
