import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { drawerShortcut } from '../../src/shared/shortcuts'

describe('drawerShortcut', () => {
  test('returns each listed key when not typing', () => {
    for (const key of ['s', 'p', 'f', 'l', 'a'] as const) {
      assert.equal(drawerShortcut({ key, typing: false }), key)
    }
  })

  test('returns null while typing', () => {
    assert.equal(drawerShortcut({ key: 'l', typing: true }), null)
  })

  test('returns null when a modifier is held', () => {
    assert.equal(drawerShortcut({ key: 'a', metaKey: true, typing: false }), null)
    assert.equal(drawerShortcut({ key: 's', ctrlKey: true, typing: false }), null)
    assert.equal(drawerShortcut({ key: 'p', altKey: true, typing: false }), null)
  })

  test('returns null for unlisted keys', () => {
    assert.equal(drawerShortcut({ key: 'x', typing: false }), null)
    assert.equal(drawerShortcut({ key: 'Enter', typing: false }), null)
  })

  test('returns null for upper-case letters', () => {
    assert.equal(drawerShortcut({ key: 'L', typing: false }), null)
    assert.equal(drawerShortcut({ key: 'A', typing: false }), null)
  })
})
