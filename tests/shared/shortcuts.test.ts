import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { drawerShortcut, isCopyBranchShortcut } from '../../src/shared/shortcuts'

describe('isCopyBranchShortcut', () => {
  test('Mod+Shift+. copies the branch name', () => {
    assert.equal(isCopyBranchShortcut({ code: 'Period', metaKey: true, shiftKey: true, typing: false }), true)
    assert.equal(isCopyBranchShortcut({ code: 'Period', ctrlKey: true, shiftKey: true, typing: false }), true)
  })

  test('needs Shift, Mod, and not typing or Alt', () => {
    assert.equal(isCopyBranchShortcut({ code: 'Period', metaKey: true, typing: false }), false)
    assert.equal(isCopyBranchShortcut({ code: 'Period', shiftKey: true, typing: false }), false)
    assert.equal(isCopyBranchShortcut({ code: 'Period', metaKey: true, shiftKey: true, typing: true }), false)
    assert.equal(isCopyBranchShortcut({ code: 'Period', metaKey: true, shiftKey: true, altKey: true, typing: false }), false)
    assert.equal(isCopyBranchShortcut({ code: 'Comma', metaKey: true, shiftKey: true, typing: false }), false)
  })
})

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
