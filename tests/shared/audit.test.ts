import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditEntries, toCsv, type AuditEntry } from '../../src/shared/audit'
import { Store } from '../../src/main/db'
import type { Op } from '../../src/shared/sync'

const at = '2026-10-29T00:00:00.000Z'

describe('auditEntries', () => {
  test('maps create, update and delete ops to one entry each', () => {
    const ops: Op[] = [
      { hlc: 'a', table: 'issues', id: 'i1', create: true, set: { title: 'A', status: 'backlog' } },
      { hlc: 'b', table: 'issues', id: 'i2', set: { title: 'B' }, unset: ['due'] },
      { hlc: 'c', table: 'projects', id: 'p1', del: true }
    ]
    assert.deepEqual(auditEntries(ops, 'ui', at), [
      { at, source: 'ui', action: 'create', table: 'issues', targetId: 'i1', fields: ['title', 'status'] },
      { at, source: 'ui', action: 'update', table: 'issues', targetId: 'i2', fields: ['title', 'due'] },
      { at, source: 'ui', action: 'delete', table: 'projects', targetId: 'p1' }
    ])
  })

  test('the given action type wins over the derived one', () => {
    const ops: Op[] = [{ hlc: 'b', table: 'issues', id: 'i2', set: { title: 'B' } }]
    assert.deepEqual(auditEntries(ops, 'mcp', at, 'patchIssue'), [
      { at, source: 'mcp', action: 'patchIssue', table: 'issues', targetId: 'i2', fields: ['title'] }
    ])
  })

  test('notifications are not audited', () => {
    const ops: Op[] = [{ hlc: 'a', table: 'notifications', id: 'n1', create: true, set: { text: 'hi' } }]
    assert.deepEqual(auditEntries(ops, 'sync', at), [])
  })

  test('fields are capped at 20 names', () => {
    const set = Object.fromEntries(Array.from({ length: 25 }, (_, n) => [`f${n}`, n]))
    const [entry] = auditEntries([{ hlc: 'a', table: 'issues', id: 'i1', set }], 'ui', at)
    assert.equal(entry.fields?.length, 20)
    assert.equal(entry.fields?.[19], 'f19')
  })
})

describe('toCsv', () => {
  test('quotes commas, quotes and line breaks', () => {
    const entries: AuditEntry[] = [
      { at, source: 'mcp', action: 'patchIssue', table: 'issues', targetId: 'i1', fields: ['title', 'due'] },
      { at, source: 'ui', action: 'update', table: 'issues', targetId: 'a,"b"\nc' }
    ]
    assert.equal(
      toCsv(entries),
      [
        'at,source,action,table,targetId,fields',
        `${at},mcp,patchIssue,issues,i1,title;due`,
        `${at},ui,update,issues,"a,""b""\nc",`
      ].join('\n')
    )
  })
})

describe('audit store', () => {
  // Stands in for AUDIT_LIMIT so the test does not need 50k rows.
  test('keeps only the newest rows across appends', async () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), 'prom-audit-')), 'prometheus.db'), 5)
    await store.open()
    const row = (n: number): AuditEntry => ({ at, source: 'ui', action: 'update', table: 'issues', targetId: `i${n}` })
    store.appendAudit([0, 1, 2].map(row))
    store.appendAudit([3, 4, 5, 6, 7, 8, 9].map(row))
    assert.deepEqual(
      store.readAudit({ limit: 100 }).map(r => r.targetId),
      ['i9', 'i8', 'i7', 'i6', 'i5']
    )
  })

  test('filters by source and pages with before', async () => {
    const store = new Store(join(mkdtempSync(join(tmpdir(), 'prom-audit-')), 'prometheus.db'))
    await store.open()
    store.appendAudit([
      { at, source: 'mcp', action: 'patchIssue', table: 'issues', targetId: 'i1', fields: ['title'] },
      { at, source: 'sync', action: 'update', table: 'projects', targetId: 'p1' },
      { at, source: 'mcp', action: 'deleteIssue', table: 'issues', targetId: 'i2' }
    ])
    assert.deepEqual(
      store.readAudit({ source: 'mcp' }).map(r => r.targetId),
      ['i2', 'i1']
    )
    const [newest] = store.readAudit({ limit: 1 })
    assert.deepEqual(store.readAudit({ before: newest.seq }).map(r => r.targetId), ['p1', 'i1'])
    assert.deepEqual(store.readAudit({ q: 'title' }).map(r => r.targetId), ['i1'])
  })
})
