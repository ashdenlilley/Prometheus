import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { fitBounds, formatLocation, mercator, parseLocation, unmercator } from '../../src/shared/location'

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not close to ${b}`)

describe('parseLocation', () => {
  test('splits an address from its coordinates suffix', () => {
    assert.deepEqual(parseLocation('Place @ -33.8, 151.2'), { address: 'Place', lat: -33.8, lon: 151.2 })
  })

  test('a bare "lat, lon" parses with an empty address', () => {
    assert.deepEqual(parseLocation('-33.8, 151.2'), { address: '', lat: -33.8, lon: 151.2 })
  })

  test('free text has no coordinates', () => {
    assert.deepEqual(parseLocation('Office, 3rd floor'), { address: 'Office, 3rd floor' })
    assert.deepEqual(parseLocation(''), { address: '' })
    assert.deepEqual(parseLocation(undefined), { address: '' })
  })

  test('out-of-range coordinates are treated as free text', () => {
    assert.deepEqual(parseLocation('Nowhere @ 95, 10'), { address: 'Nowhere @ 95, 10' })
    assert.deepEqual(parseLocation('0, 200'), { address: '0, 200' })
  })
})

describe('formatLocation', () => {
  test('round-trips through parseLocation', () => {
    const s = formatLocation('Sydney Opera House', -33.8568, 151.2153)
    assert.equal(s, 'Sydney Opera House @ -33.8568, 151.2153')
    assert.deepEqual(parseLocation(s), { address: 'Sydney Opera House', lat: -33.8568, lon: 151.2153 })
  })

  test('without coordinates it returns the address unchanged', () => {
    assert.equal(formatLocation('Office'), 'Office')
  })

  test('an empty address gives a bare lat, lon', () => {
    assert.equal(formatLocation('', 1.5, -2.25), '1.5, -2.25')
  })
})

describe('mercator', () => {
  test('(0,0) is the centre of the world', () => {
    const p = mercator(0, 0)
    near(p.x, 0.5)
    near(p.y, 0.5)
  })

  test('unmercator inverts mercator', () => {
    const p = mercator(-33.8568, 151.2153)
    const back = unmercator(p.x, p.y)
    near(back.lat, -33.8568)
    near(back.lon, 151.2153)
  })
})

describe('fitBounds', () => {
  test('a single point uses zoom 12 centred on it', () => {
    assert.deepEqual(fitBounds([{ lat: -33.8568, lon: 151.2153 }], 1000, 560), {
      zoom: 12,
      center: { lat: -33.8568, lon: 151.2153 }
    })
  })

  test('several points fit inside the viewport at an integer zoom', () => {
    const pts = [
      { lat: -33.8568, lon: 151.2153 },
      { lat: -37.8136, lon: 144.9631 }
    ]
    const { zoom, center } = fitBounds(pts, 1000, 560)
    assert.ok(Number.isInteger(zoom) && zoom >= 1 && zoom <= 16)
    const c = mercator(center.lat, center.lon)
    const size = 256 * 2 ** zoom
    for (const p of pts) {
      const m = mercator(p.lat, p.lon)
      assert.ok(Math.abs(m.x * size - c.x * size) <= 500, 'x outside viewport')
      assert.ok(Math.abs(m.y * size - c.y * size) <= 280, 'y outside viewport')
    }
  })

  test('no points gives a world view', () => {
    assert.deepEqual(fitBounds([], 1000, 560), { zoom: 2, center: { lat: 0, lon: 0 } })
  })
})
