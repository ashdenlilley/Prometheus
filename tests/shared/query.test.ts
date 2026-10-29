import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { childrenOf, formatNumber, groupIssues, issuesToCSV, parseCSV, progress, summarize } from '../../src/shared/query'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import { DEFAULT_STATUSES, type AppData, type Column, type Issue, type Project } from '../../src/shared/types'

const project = (columns: Column[] = []): Project =>
  blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000', columns })

const data = (issues: Issue[] = [], cycles: AppData['cycles'] = []): AppData => ({ ...emptyData(), issues, cycles })

// createIssue numbers issues from the data passed in, so pass an explicit number via the patch.
const issue = (number: number, patch: Partial<Issue> = {}): Issue =>
  createIssue(emptyData(), 'p1', `Issue ${number}`, { number, ...patch })

const col = (id: string, type: Column['type'] = 'number', extra: Partial<Column> = {}): Column => ({ id, name: id, type, ...extra })

const noName = () => ''

describe('groupIssues', () => {
  test('without groupBy returns one unlabelled group holding every issue', () => {
    const items = [issue(1), issue(2)]
    const groups = groupIssues(items, project(), null, noName, noName)
    assert.equal(groups.length, 1)
    assert.equal(groups[0].key, 'all')
    assert.deepEqual(groups[0].items, items)
  })

  test('status groups follow the project status order and keep empty groups', () => {
    const groups = groupIssues([issue(1, { status: 'done' }), issue(2, { status: 'backlog' })], project(), 'status', noName, noName)
    assert.deepEqual(
      groups.map(g => g.key),
      DEFAULT_STATUSES.map(s => s.id)
    )
    assert.deepEqual(groups.find(g => g.key === 'todo')?.items, [])
    assert.equal(groups.find(g => g.key === 'done')?.color, DEFAULT_STATUSES[3].color)
  })

  test('priority groups run from Urgent to Low', () => {
    const items = [issue(1, { priority: 4 }), issue(2, { priority: 1 }), issue(3, { priority: 3 })]
    const labels = groupIssues(items, project(), 'priority', noName, noName).map(g => g.label)
    assert.deepEqual(labels, ['Urgent', 'Medium', 'Low'])
  })

  test('priority groups follow PRIORITIES order, so "No priority" comes first', () => {
    // Explicit PRIORITIES ordering (index 0 is "No priority"); other groupings put "No ..." last.
    const items = [issue(1, { priority: 0 }), issue(2, { priority: 1 })]
    const labels = groupIssues(items, project(), 'priority', noName, noName).map(g => g.label)
    assert.deepEqual(labels, ['No priority', 'Urgent'])
  })

  test('label groups sort alphabetically with "None" and "No ..." groups last', () => {
    const items = [issue(1, { labels: ['zeta'] }), issue(2, { labels: [] }), issue(3, { labels: ['alpha', 'beta'] })]
    const groups = groupIssues(items, project(), 'labels', noName, noName)
    assert.deepEqual(
      groups.map(g => g.label),
      ['alpha', 'zeta', 'No label']
    )
    assert.deepEqual(groups[0].items.map(i => i.number), [3])
  })

  test('cycle and milestone groups use the name callbacks, with fallbacks for unset ids', () => {
    const items = [issue(1, { cycleId: 'c1' }), issue(2)]
    const cycles = groupIssues(items, project(), 'cycle', id => `Name of ${id}`, noName)
    assert.deepEqual(cycles.map(g => g.label).sort(), ['Name of c1', 'No cycle'])
    const milestones = groupIssues([issue(1, { milestoneId: 'm1' })], project(), 'milestone', noName, id => `M ${id}`)
    assert.deepEqual(milestones.map(g => g.label), ['M m1'])
  })

  test('custom dropdown groups map option ids to labels, fall back to raw values, and use None when empty', () => {
    const p = project([col('team', 'dropdown', { options: [{ id: 'o1', label: 'Frontend', color: '#fff' }] })])
    const items = [issue(1, { values: { team: 'o1' } }), issue(2, { values: { team: 'gone' } }), issue(3)]
    const labels = groupIssues(items, p, 'team', noName, noName).map(g => g.label)
    assert.deepEqual(labels, ['Frontend', 'gone', 'None'])
  })

  test('empty issue list gives no groups for a plain grouping, but empty buckets for status', () => {
    assert.deepEqual(groupIssues([], project(), 'cycle', noName, noName), [])
    assert.equal(groupIssues([], project(), 'status', noName, noName).every(g => g.items.length === 0), true)
  })
})

describe('progress', () => {
  const statuses = DEFAULT_STATUSES

  test('counts completed issues over all non-canceled issues', () => {
    const items = [issue(1, { status: 'done' }), issue(2, { status: 'todo' }), issue(3, { status: 'canceled' })]
    assert.deepEqual(progress(items, statuses), { done: 1, total: 2, pct: 50 })
  })

  test('rounds the percentage to a whole number', () => {
    const items = [issue(1, { status: 'done' }), issue(2, { status: 'todo' }), issue(3, { status: 'todo' })]
    assert.equal(progress(items, statuses).pct, 33)
    assert.equal(progress([...items, issue(4, { status: 'done' })], statuses).pct, 50)
  })

  test('empty input and all-canceled input give zeros rather than NaN', () => {
    assert.deepEqual(progress([], statuses), { done: 0, total: 0, pct: 0 })
    assert.deepEqual(progress([issue(1, { status: 'canceled' })], statuses), { done: 0, total: 0, pct: 0 })
  })

  test('an unknown status counts as unstarted: in the total, never done', () => {
    assert.deepEqual(progress([issue(1, { status: 'mystery' })], statuses), { done: 0, total: 1, pct: 0 })
  })
})

describe('childrenOf', () => {
  test('returns direct children only, not grandchildren', () => {
    const items = [issue(1), issue(2, { parentId: 'i1' }), issue(3, { parentId: 'i2' }), issue(4, { parentId: 'i1' })]
    const kids = childrenOf(items, 'i1')
    assert.deepEqual(kids.map(i => i.number), [2, 4])
  })

  test('returns an empty array when nothing points at the parent', () => {
    assert.deepEqual(childrenOf([issue(1)], 'i1'), [])
    assert.deepEqual(childrenOf([], 'i1'), [])
  })
})

describe('summarize', () => {
  const numberCol = col('est')
  const values = (vs: (number | string | undefined)[]) => vs.map((v, n) => issue(n + 1, { values: v === undefined ? {} : { est: v } }))

  test('sum is the default footer for number columns and ignores non-numeric and missing values', () => {
    assert.equal(summarize(numberCol, values([2, 3, 'x', undefined])), '5')
  })

  test('sum, avg, min and max over numeric values only', () => {
    const items = values([1, 2, 6])
    assert.equal(summarize({ ...numberCol, footer: 'sum' }, items), '9')
    assert.equal(summarize({ ...numberCol, footer: 'avg' }, items), '3')
    assert.equal(summarize({ ...numberCol, footer: 'min' }, items), '1')
    assert.equal(summarize({ ...numberCol, footer: 'max' }, items), '6')
  })

  test('numeric footers return an empty string when there are no numbers', () => {
    const items = values([undefined, 'x'])
    for (const footer of ['sum', 'avg', 'min', 'max'] as const) assert.equal(summarize({ ...numberCol, footer }, items), '')
  })

  test('count counts items with a non-empty value; none and text columns give an empty string', () => {
    const items = values([0, '', undefined, 4])
    assert.equal(summarize({ ...numberCol, footer: 'count' }, items), '2')
    assert.equal(summarize({ ...numberCol, footer: 'none' }, items), '')
    assert.equal(summarize(col('t', 'text'), items), '')
  })

  test('applies the column number format to the result', () => {
    const cur = col('est', 'number', { numberFormat: 'currency', currency: 'EUR', footer: 'sum' })
    const items = values([1.5, 2])
    const expected = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(3.5)
    assert.equal(summarize(cur, items), expected)
  })
})

describe('formatNumber', () => {
  test('rounds to two decimal places in the default format', () => {
    assert.equal(formatNumber(1.234), '1.23')
    assert.equal(formatNumber(2.5), '2.5')
    assert.equal(formatNumber(3), '3')
  })

  test('percent appends a sign to the rounded value; decimal always shows two places', () => {
    assert.equal(formatNumber(50, col('p', 'number', { numberFormat: 'percent' })), '50%')
    assert.equal(formatNumber(2, col('d', 'number', { numberFormat: 'decimal' })), '2.00')
    assert.equal(formatNumber(0, col('d', 'number', { numberFormat: 'decimal' })), '0.00')
  })

  test('currency uses the column currency, defaulting to USD', () => {
    const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(7)
    assert.equal(formatNumber(7, col('c', 'number', { numberFormat: 'currency' })), usd)
  })
})

describe('issuesToCSV and parseCSV', () => {
  test('writes the fixed header, then custom columns, with one row per issue', () => {
    const p = project([col('sprint', 'number', { name: 'Sprint' })])
    const items = [issue(1, { title: 'Hello', status: 'todo', priority: 1, labels: ['a', 'b'], values: { sprint: 3 } })]
    const lines = issuesToCSV(data(items), p, items).split('\n')
    assert.equal(lines[0], 'Key,Title,Status,Priority,Assignee,Labels,Start,Due,Estimate,Cycle,PR,Sprint')
    assert.equal(lines[1], 'T-1,Hello,Todo,Urgent,,a; b,,,,,,3')
  })

  test('an issue with no values or cycle leaves those cells empty', () => {
    const p = project([col('sprint', 'number', { name: 'Sprint' })])
    const items = [issue(1, { priority: 0 })]
    assert.equal(issuesToCSV(data(items), p, items).split('\n')[1], 'T-1,Issue 1,Backlog,No priority,,,,,,,,')
  })

  test('cycle column shows the cycle name', () => {
    const p = project()
    const items = [issue(1, { cycleId: 'c1' })]
    const d = data(items, [{ id: 'c1', projectId: 'p1', name: 'Sprint 9', startDate: '2026-01-01', endDate: '2026-01-14' }])
    assert.equal(issuesToCSV(d, p, items).split('\n')[1].split(',')[9], 'Sprint 9')
  })

  test('no issues gives just the header line', () => {
    assert.equal(issuesToCSV(data(), project(), []), 'Key,Title,Status,Priority,Assignee,Labels,Start,Due,Estimate,Cycle,PR')
  })

  test('quotes fields containing commas, double quotes and newlines, doubling any quotes', () => {
    const items = [issue(1, { title: 'a, "b"\nc' })]
    const line = issuesToCSV(data(items), project(), items).split('\n').slice(1).join('\n')
    assert.ok(line.includes('"a, ""b""\nc"'), line)
  })

  test('parseCSV handles CRLF, a trailing newline and blank lines', () => {
    assert.deepEqual(parseCSV('a,b\r\n\r\n1,2\n'), [
      ['a', 'b'],
      ['1', '2']
    ])
  })

  test('parseCSV reads quoted cells with commas, escaped quotes and embedded newlines', () => {
    assert.deepEqual(parseCSV('x,"he said ""hi""","line1\nline2"\n'), [['x', 'he said "hi"', 'line1\nline2']])
  })

  test('parseCSV keeps empty cells, including a trailing empty cell', () => {
    assert.deepEqual(parseCSV('a,,c\n1,2,'), [
      ['a', '', 'c'],
      ['1', '2', '']
    ])
  })

  test('parseCSV on an unterminated quote takes the rest of the input as one cell', () => {
    assert.deepEqual(parseCSV('a,"b,c\nd'), [['a', 'b,c\nd']])
  })

  test('parseCSV on empty text gives no rows', () => {
    assert.deepEqual(parseCSV(''), [])
  })

  test('round trip: tricky titles, labels and custom values come back unchanged', () => {
    const items = [issue(1, { title: 'Commas, quotes "x" and\nnewlines', labels: ['a;b', 'c'] }), issue(2, { title: '' })]
    const rows = parseCSV(issuesToCSV(data(items), project(), items))
    assert.equal(rows.length, 3)
    assert.equal(rows[0][0], 'Key')
    assert.equal(rows[1][0], 'T-1')
    assert.equal(rows[1][1], 'Commas, quotes "x" and\nnewlines')
    assert.equal(rows[1][5], 'a;b; c')
    assert.equal(rows[2][1], '')
  })

  test('a custom value with commas or quotes is escaped once (OS-302)', () => {
    const p = project([col('notes', 'text', { name: 'Notes' })])
    const items = [issue(1, { values: { notes: 'a, "q"' } })]
    const csv = issuesToCSV(data(items), p, items)
    assert.equal(csv.split('\n')[1], 'T-1,Issue 1,Backlog,No priority,,,,,,,,"a, ""q"""')
    assert.equal(parseCSV(csv)[1][11], 'a, "q"')
  })

  test('round trip: custom values with commas and quotes re-import unchanged (OS-302)', () => {
    const p = project([col('notes', 'text', { name: 'Notes' }), col('quote', 'text', { name: 'Quote' }), col('plain', 'text', { name: 'Plain' })])
    const items = [
      issue(1, { values: { notes: 'x, y, z', quote: 'she said "hi", then left', plain: 'simple' } }),
      issue(2, { values: { notes: '"', quote: '""', plain: ',' } })
    ]
    const rows = parseCSV(issuesToCSV(data(items), p, items))
    assert.deepEqual(rows[0].slice(11), ['Notes', 'Quote', 'Plain'])
    assert.deepEqual(rows[1].slice(11), ['x, y, z', 'she said "hi", then left', 'simple'])
    assert.deepEqual(rows[2].slice(11), ['"', '""', ','])
  })

  test('BUG-check: a carriage return inside a title survives the round trip', () => {
    const items = [issue(1, { title: 'one\rtwo' })]
    const rows = parseCSV(issuesToCSV(data(items), project(), items))
    assert.equal(rows[1][1], 'one\rtwo')
  })
})
