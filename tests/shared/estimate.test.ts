import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { formatEstimate, parseEstimate, TSHIRT } from '../../src/shared/estimate'
import { issuesToCSV } from '../../src/shared/query'
import { createIssue } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { Project } from '../../src/shared/types'

describe('t-shirt estimates', () => {
  test('every size maps to its stored number and back', () => {
    assert.deepEqual(TSHIRT, [['XS', 1], ['S', 2], ['M', 3], ['L', 5], ['XL', 8]])
    for (const [label, value] of TSHIRT) {
      assert.equal(formatEstimate(value, 'tshirt'), label)
      assert.equal(parseEstimate(label, 'tshirt'), value)
    }
  })

  test('parsing ignores case and surrounding space', () => {
    assert.equal(parseEstimate('xl', 'tshirt'), 8)
    assert.equal(parseEstimate(' m ', 'tshirt'), 3)
  })

  test('a number string still parses in t-shirt mode', () => {
    assert.equal(parseEstimate('5', 'tshirt'), 5)
  })

  test('non-standard values show the nearest size, ties going to the larger', () => {
    assert.equal(formatEstimate(4, 'tshirt'), 'L') // between M=3 and L=5: tie goes to L
    assert.equal(formatEstimate(0, 'tshirt'), 'XS')
    assert.equal(formatEstimate(6, 'tshirt'), 'L')
    assert.equal(formatEstimate(100, 'tshirt'), 'XL')
  })
})

describe('points estimates', () => {
  test('formatting is the plain number', () => {
    assert.equal(formatEstimate(3), '3')
    assert.equal(formatEstimate(3, 'points'), '3')
    assert.equal(formatEstimate(2.5, 'points'), '2.5')
  })

  test('parsing gives a number, and letters are invalid', () => {
    assert.equal(parseEstimate('13'), 13)
    assert.equal(parseEstimate('0', 'points'), 0)
    assert.equal(parseEstimate('M', 'points'), undefined)
  })
})

describe('blank and invalid input', () => {
  test('undefined and blank text give no estimate', () => {
    assert.equal(formatEstimate(undefined, 'tshirt'), '')
    assert.equal(formatEstimate(undefined), '')
    assert.equal(parseEstimate(''), undefined)
    assert.equal(parseEstimate('   ', 'tshirt'), undefined)
  })

  test('invalid text gives no estimate', () => {
    assert.equal(parseEstimate('huge', 'tshirt'), undefined)
    assert.equal(parseEstimate('XXL', 'tshirt'), undefined)
    assert.equal(parseEstimate('abc'), undefined)
    assert.equal(parseEstimate('Infinity'), undefined)
  })
})

describe('CSV export of estimates', () => {
  const project = (estimateScale?: Project['estimateScale']): Project =>
    blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000', estimateScale })
  const data = emptyData()
  const issues = [createIssue(data, 'p1', 'Sized', { number: 1, estimate: 5 }), createIssue(data, 'p1', 'Unsized', { number: 2 })]

  // Column index 8 is Estimate in the header.
  const estimateCells = (csv: string) => csv.split('\n').slice(1).map(row => row.split(',')[8])

  test('a t-shirt project exports letters', () => {
    assert.deepEqual(estimateCells(issuesToCSV(data, project('tshirt'), issues)), ['L', ''])
  })

  test('a points project exports numbers', () => {
    assert.deepEqual(estimateCells(issuesToCSV(data, project('points'), issues)), ['5', ''])
    assert.deepEqual(estimateCells(issuesToCSV(data, project(), issues)), ['5', ''])
  })
})
