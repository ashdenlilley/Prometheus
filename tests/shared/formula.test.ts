import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateFormula } from '../../src/shared/formula'
import { blankProject } from '../../src/shared/seed'
import type { Column, Issue, Project } from '../../src/shared/types'

const col = (id: string, name: string, type: Column['type'] = 'number', formula?: string): Column => ({ id, name, type, formula })

const project = (columns: Column[]): Project =>
  blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000', columns })

const issue = (values: Issue['values']): Issue => ({
  id: 'i1',
  projectId: 'p1',
  number: 1,
  title: 'Issue',
  description: '',
  status: 'todo',
  priority: 0,
  assignee: '',
  labels: [],
  relations: [],
  comments: [],
  activity: [],
  values,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

const cols = [col('est', 'Estimate'), col('pts', 'Story Points'), col('done', 'Done', 'checkbox'), col('title', 'Title', 'text')]
const proj = project(cols)
const row = issue({ est: 4, pts: 10, done: true, title: 'Hello' })

const ev = (expr: string, i: Issue = row, p: Project = proj) => evaluateFormula(expr, i, p)

describe('arithmetic', () => {
  test('evaluates basic operators', () => {
    assert.equal(ev('1 + 2'), 3)
    assert.equal(ev('5 - 8'), -3)
    assert.equal(ev('6 * 7'), 42)
    assert.equal(ev('9 / 2'), 4.5)
    assert.equal(ev('10 % 4'), 2)
  })

  test('division and modulo by zero evaluate to 0 rather than failing', () => {
    assert.equal(ev('5 / 0'), 0)
    assert.equal(ev('5 % 0'), 0)
    assert.equal(ev('Estimate / (Estimate - 4)'), 0)
  })

  test('overflow to a non-finite result is reported as undefined', () => {
    assert.equal(ev('10 ^ 400'), undefined)
  })

  test('unary minus and plus', () => {
    assert.equal(ev('-Estimate'), -4)
    assert.equal(ev('+Estimate'), 4)
    assert.equal(ev('--3'), 3)
  })
})

describe('precedence and grouping', () => {
  test('multiplication binds tighter than addition', () => {
    assert.equal(ev('2 + 3 * 4'), 14)
  })

  test('parentheses override precedence', () => {
    assert.equal(ev('(2 + 3) * 4'), 20)
  })

  test('exponent is right-associative', () => {
    assert.equal(ev('2 ^ 3 ^ 2'), 512)
  })

  test('comparisons yield 1 or 0 and bind looser than arithmetic', () => {
    assert.equal(ev('2 + 2 = 4'), 1)
    assert.equal(ev('Estimate < Story Points'), 1)
    assert.equal(ev('Estimate >= 5'), 0)
    assert.equal(ev('Estimate <> 4'), 0)
  })
})

describe('functions', () => {
  test('SUM, AVG, MIN and MAX take any number of arguments', () => {
    assert.equal(ev('SUM(1, 2, 3)'), 6)
    assert.equal(ev('AVG(2, 4, 9)'), 5)
    assert.equal(ev('MIN(3, -1, 2)'), -1)
    assert.equal(ev('MAX(3, -1, 2)'), 3)
  })

  test('functions with no arguments fall back to 0', () => {
    assert.equal(ev('SUM()'), 0)
    assert.equal(ev('MAX()'), 0)
  })

  test('ABS and ROUND', () => {
    assert.equal(ev('ABS(-7.5)'), 7.5)
    assert.equal(ev('ROUND(3.7)'), 4)
    assert.equal(ev('ROUND(1234.5678, 2)'), 1234.57)
    assert.equal(ev('ROUND(1234.5678, -2)'), 1200)
  })

  test('IF picks a branch and treats any non-zero condition as true', () => {
    assert.equal(ev('IF(Estimate > 3, 100, 200)'), 100)
    assert.equal(ev('IF(0, 1, 2)'), 2)
    assert.equal(ev('IF(-1, 1, 2)'), 1)
  })

  test('function names are case-insensitive', () => {
    assert.equal(ev('sum(1, 2) * max(1, 3)'), 9)
  })
})

describe('column references', () => {
  test('resolves number column values by name, case-insensitively', () => {
    assert.equal(ev('estimate * 2'), 8)
  })

  test('column names containing spaces are matched longest first', () => {
    assert.equal(ev('Story Points + Estimate'), 14)
  })

  test('checkbox values count as 1 or 0', () => {
    assert.equal(ev('Done + 1'), 2)
    assert.equal(ev('Done * Estimate'), 4)
  })

  test('missing or non-numeric values count as 0', () => {
    assert.equal(ev('Estimate + Story Points', issue({ est: 4 })), 4)
    assert.equal(ev('Title + 1'), undefined, 'text columns are not referenceable names')
  })

  test('formula columns can reference other formula columns', () => {
    const p = project([col('est', 'Estimate'), col('dbl', 'Double', 'formula', 'Estimate * 2'), col('quad', 'Quad', 'formula', 'Double * 2')])
    assert.equal(evaluateFormula('Quad + 1', row, p), 17)
  })

  test('cyclic formula columns are cut off and yield undefined', () => {
    const p = project([col('a', 'A', 'formula', 'B + 1'), col('b', 'B', 'formula', 'A + 1')])
    assert.equal(evaluateFormula('A', row, p), undefined)
  })
})

describe('errors', () => {
  test('unknown names yield undefined', () => {
    assert.equal(ev('Budget * 2'), undefined)
    assert.equal(ev('FOO(1)'), undefined)
  })

  test('malformed expressions yield undefined', () => {
    assert.equal(ev(''), undefined)
    assert.equal(ev('1 +'), undefined)
    assert.equal(ev('(1 + 2'), undefined)
    assert.equal(ev('1 + 2)'), undefined)
    assert.equal(ev('SUM(1 2)'), undefined)
    assert.equal(ev('1 $ 2'), undefined)
  })
})
