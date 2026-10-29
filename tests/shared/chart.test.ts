import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { linePoints, pieSlices, svgArcPath } from '../../src/shared/chart'

const group = (label: string, value: number) => ({ label, value, color: '#000000' })

describe('pieSlices', () => {
  test('slice angles sum to a full turn and run back to back', () => {
    const slices = pieSlices([group('a', 1), group('b', 2), group('c', 5)])
    const sweep = slices.reduce((s, sl) => s + (sl.end - sl.start), 0)
    assert.ok(Math.abs(sweep - Math.PI * 2) < 1e-9)
    assert.ok(Math.abs(slices[1].start - slices[0].end) < 1e-9)
    assert.ok(Math.abs(slices[2].percent - 62.5) < 1e-9)
  })

  test('zero values get no slice', () => {
    const slices = pieSlices([group('a', 0), group('b', 3), group('c', 0)])
    assert.deepEqual(slices.map(s => s.label), ['b'])
  })

  test('a single slice is a full circle', () => {
    const [only] = pieSlices([group('a', 4), group('b', 0)])
    assert.equal(only.percent, 100)
    assert.ok(Math.abs(only.end - only.start - Math.PI * 2) < 1e-9)
  })

  test('no positive values gives no slices', () => {
    assert.deepEqual(pieSlices([group('a', 0)]), [])
  })
})

describe('linePoints', () => {
  test('date labels are sorted chronologically', () => {
    const points = linePoints([group('2026-03-01', 1), group('2026-01-15', 2), group('2026-02', 3)], 100, 100)
    assert.deepEqual(points.map(p => p.label), ['2026-01-15', '2026-02', '2026-03-01'])
    assert.equal(points[0].x, 0)
    assert.equal(points[2].x, 100)
  })

  test('ISO week labels are sorted chronologically', () => {
    const points = linePoints([group('2026-W10', 1), group('2026-W02', 1)], 100, 100)
    assert.deepEqual(points.map(p => p.label), ['2026-W02', '2026-W10'])
  })

  test('other labels keep the given order', () => {
    const points = linePoints([group('Zed', 1), group('Alpha', 2)], 100, 100)
    assert.deepEqual(points.map(p => p.label), ['Zed', 'Alpha'])
  })

  test('the largest value reaches the top of the plot', () => {
    const points = linePoints([group('a', 2), group('b', 4)], 100, 50)
    assert.equal(points[1].y, 0)
    assert.equal(points[0].y, 25)
  })
})

describe('svgArcPath', () => {
  test('a partial slice is one arc from the centre', () => {
    const d = svgArcPath(50, 50, 40, 0, Math.PI / 2)
    assert.equal(d.match(/A /g)?.length, 1)
    assert.ok(d.startsWith('M 50 50 L '))
  })

  test('a full circle is two arcs and has no NaN', () => {
    const d = svgArcPath(50, 50, 40, -Math.PI / 2, Math.PI * 1.5)
    assert.equal(d.match(/A /g)?.length, 2)
    assert.ok(!d.includes('NaN'))
  })
})
