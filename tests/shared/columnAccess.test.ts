import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accessChanged, columnMode, columnsError, isColumnAccess, mergeHidden, stripHidden, valuesError,
  type ColumnAccess
} from '../../src/shared/permissions'

type Col = { id: string; name: string; access?: ColumnAccess }

const RO: ColumnAccess = { readOnlyFor: ['member', 'guest'] }
const HID: ColumnAccess = { hiddenFor: ['member', 'viewer'] }
const BOTH: ColumnAccess = { readOnlyFor: ['member'], hiddenFor: ['member'] }

test('columnMode by role', () => {
  assert.equal(columnMode('owner', { access: HID }), 'edit')
  assert.equal(columnMode(null, { access: HID }), 'edit')
  assert.equal(columnMode('member', { access: HID }), 'hidden')
  assert.equal(columnMode('member', { access: RO }), 'read')
  assert.equal(columnMode('guest', { access: RO }), 'read')
  assert.equal(columnMode('guest', { access: HID }), 'edit')
  assert.equal(columnMode('member', { access: BOTH }), 'hidden')
  assert.equal(columnMode('member', {}), 'edit')
})

test('viewers always read, unless the column is hidden from them', () => {
  assert.equal(columnMode('viewer', {}), 'read')
  assert.equal(columnMode('viewer', { access: RO }), 'read')
  assert.equal(columnMode('viewer', { access: HID }), 'hidden')
})

const cols: Col[] = [
  { id: 'ro', name: 'Budget', access: RO },
  { id: 'hid', name: 'Secret', access: { hiddenFor: ['member'] } },
  { id: 'plain', name: 'Notes' }
]

test('valuesError refuses edits to read-only columns', () => {
  const before = { ro: 1, hid: 'x', plain: 'a' }
  assert.equal(valuesError('member', cols, before, { ...before, ro: 2 }), 'the Budget column is read-only for members')
  assert.equal(valuesError('member', cols, before, { ro: 1, hid: 'x', plain: 'b' }), null)
  assert.equal(valuesError('member', cols, {}, { ro: '' }), null)
  assert.equal(valuesError('member', cols, before, { ...before, plain: 'b' }), null)
})

test('valuesError refuses changes to hidden columns, allows a missing key', () => {
  const before = { ro: 1, hid: 'x', plain: 'a' }
  assert.equal(valuesError('member', cols, before, { ...before, hid: 'y' }), 'the Secret column is hidden from members')
  assert.equal(valuesError('member', cols, before, { ro: 1, plain: 'a' }), null)
})

test('valuesError never refuses the owner', () => {
  assert.equal(valuesError('owner', cols, { ro: 1, hid: 'x' }, { ro: 2, hid: 'y' }), null)
})

test('mergeHidden restores hidden values and deletes ones before lacked', () => {
  const after = { plain: 'b', hid: 'y' }
  assert.deepEqual(mergeHidden('member', cols, { hid: 'x', plain: 'a' }, after), { plain: 'b', hid: 'x' })
  assert.deepEqual(mergeHidden('member', cols, { plain: 'a' }, after), { plain: 'b' })
  assert.equal(mergeHidden('owner', cols, { hid: 'x' }, after), after)
  assert.equal(mergeHidden('member', [cols[0]], { hid: 'x' }, after), after)
})

test('stripHidden removes hidden keys only', () => {
  assert.deepEqual(stripHidden('member', cols, { hid: 'x', ro: 1, plain: 'a' }), { ro: 1, plain: 'a' })
  const values = { ro: 1 }
  assert.equal(stripHidden('member', cols, values), values)
  assert.deepEqual(stripHidden('owner', cols, { hid: 'x' }), { hid: 'x' })
})

const OWNER_ONLY = 'only the owner can change column permissions or restricted columns'
const plain: Col = { id: 'p', name: 'Plain' }
const locked: Col = { id: 'r', name: 'Locked', access: { readOnlyFor: ['member'] } }
const added: Col = { id: 'n', name: 'New' }
const addedLocked: Col = { id: 'n', name: 'New', access: { hiddenFor: ['guest'] } }
const renamed: Col = { id: 'r', name: 'Renamed', access: { readOnlyFor: ['member'] } }
const grantedAccess: Col = { id: 'p', name: 'Plain', access: { readOnlyFor: ['guest'] } }

test('columnsError: members can add plain columns but not change restricted ones', () => {
  const before = [plain, locked]
  assert.equal(columnsError('member', before, [...before, added]), null)
  assert.equal(columnsError('member', before, [...before, addedLocked]), OWNER_ONLY)
  assert.equal(columnsError('member', before, [plain, renamed]), OWNER_ONLY)
  assert.equal(columnsError('member', before, [plain]), OWNER_ONLY)
  assert.equal(columnsError('member', [plain], [grantedAccess]), OWNER_ONLY)
})

test('columnsError: owner can change anything', () => {
  assert.equal(columnsError('owner', [plain, locked], [plain]), null)
  assert.equal(columnsError('owner', [plain], [grantedAccess]), null)
})

test('isColumnAccess accepts valid rules and rejects owner or non-arrays', () => {
  assert.equal(isColumnAccess(undefined), true)
  assert.equal(isColumnAccess(null), true)
  assert.equal(isColumnAccess({ readOnlyFor: ['member'], hiddenFor: ['guest', 'viewer'] }), true)
  assert.equal(isColumnAccess({ readOnlyFor: ['owner'] }), false)
  assert.equal(isColumnAccess({ hiddenFor: 'member' }), false)
  assert.equal(isColumnAccess({ hiddenFor: ['member', 'guest', 'viewer', 'member'] }), false)
  assert.equal(isColumnAccess('member'), false)
})

test('accessChanged compares restricted columns only', () => {
  assert.equal(accessChanged([plain], [plain, added]), false)
  assert.equal(accessChanged([locked], [locked]), false)
  assert.equal(accessChanged([locked], [addedLocked]), true)
  assert.equal(accessChanged([locked], [plain]), true)
  const plainRenamed: Col = { ...plain, name: 'Renamed' }
  assert.equal(accessChanged([plain], [plainRenamed]), false)
})
