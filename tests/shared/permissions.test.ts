import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canManageMembers, canReadRow, canSeeProject, isProjectAccess, roleLabel, writeError,
  type Principal, type ProjectAccess, type RowScope
} from '../../src/shared/permissions'

const owner: Principal = { userId: 'o', role: 'owner', projects: [] }
const member: Principal = { userId: 'm', role: 'member', projects: [] }
const viewer: Principal = { userId: 'v', role: 'viewer', projects: [] }
const guest = (projects: string[]): Principal => ({ userId: 'g', role: 'guest', projects })

const OPEN: ProjectAccess = { mode: 'open', users: [] }
const LISTS_M_G: ProjectAccess = { mode: 'restricted', users: ['m', 'g'] }
const LISTS_OTHER: ProjectAccess = { mode: 'restricted', users: ['x'] }
const openRow: RowScope = { project: 'p1', access: OPEN }
const listedRow: RowScope = { project: 'p2', access: LISTS_M_G }
const hiddenRow: RowScope = { project: 'p3', access: LISTS_OTHER }
const unscoped: RowScope = { project: null }

test('owner sees and edits everything', () => {
  assert.equal(canSeeProject(owner, 'p3', LISTS_OTHER), true)
  assert.equal(canReadRow(owner, 'webhooks', unscoped), true)
  assert.equal(writeError(owner, 'webhooks', ['access'], hiddenRow, null), null)
})

test('open project is visible to members, viewers and granted guests only', () => {
  assert.equal(canSeeProject(member, 'p1', OPEN), true)
  assert.equal(canSeeProject(viewer, 'p1', OPEN), true)
  assert.equal(canSeeProject(guest(['p1']), 'p1', OPEN), true)
  assert.equal(canSeeProject(guest([]), 'p1', OPEN), false)
})

test('restricted project: listed users see it, unlisted users do not', () => {
  assert.equal(canSeeProject(member, 'p2', LISTS_M_G), true)
  assert.equal(canSeeProject(guest(['p2']), 'p2', LISTS_M_G), true)
  assert.equal(canSeeProject(viewer, 'p2', LISTS_M_G), false)
  assert.equal(canSeeProject(member, 'p3', LISTS_OTHER), false)
  assert.equal(canSeeProject(guest(['p3']), 'p3', LISTS_OTHER), false)
})

test('unscoped rows: guests only read spaces and teams, everyone else reads all', () => {
  assert.equal(canReadRow(member, 'settings', unscoped), true)
  assert.equal(canReadRow(viewer, 'settings', unscoped), true)
  assert.equal(canReadRow(guest([]), 'spaces', unscoped), true)
  assert.equal(canReadRow(guest([]), 'teams', unscoped), true)
  assert.equal(canReadRow(guest([]), 'agents', unscoped), false)
})

test('viewers are refused every write', () => {
  assert.equal(writeError(viewer, 'issues', ['title'], openRow, openRow), 'viewers have read-only access')
  assert.equal(writeError(viewer, 'webhooks', ['url'], unscoped, unscoped), 'viewers have read-only access')
})

test('owner-only tables refuse member and guest writes', () => {
  assert.equal(writeError(member, 'webhooks', ['url'], openRow, openRow), 'only the owner can change webhooks')
  assert.equal(writeError(guest(['p1']), 'integrations', ['name'], openRow, openRow), 'only the owner can change integrations')
})

test('project access field can only be changed by the owner', () => {
  assert.equal(writeError(member, 'projects', ['access'], openRow, openRow), 'only the owner can change project access')
  assert.equal(writeError(member, 'projects', ['name'], openRow, openRow), null)
})

test('guests can only write issues, docs and git links', () => {
  assert.equal(writeError(guest(['p1']), 'issues', ['title'], openRow, openRow), null)
  assert.equal(writeError(guest(['p1']), 'cycles', ['name'], openRow, openRow), 'guests can only edit issues and docs in their projects')
  assert.equal(writeError(guest(['p1']), 'docs', ['body'], unscoped, unscoped), 'guests can only edit issues and docs in their projects')
})

test('guest edits to granted vs ungranted projects', () => {
  assert.equal(writeError(guest(['p1']), 'issues', ['title'], openRow, openRow), null)
  assert.equal(writeError(guest([]), 'issues', ['title'], openRow, openRow), 'that row is not visible to you')
  assert.equal(writeError(member, 'issues', ['title'], hiddenRow, hiddenRow), 'that row is not visible to you')
})

test('moving a row from a visible project to a hidden one is refused', () => {
  assert.equal(writeError(guest(['p1']), 'issues', ['projectId'], openRow, hiddenRow), 'that project is not visible to you')
  assert.equal(writeError(member, 'issues', ['projectId'], listedRow, hiddenRow), 'that project is not visible to you')
})

test('deleting a hidden row is refused, deleting a visible one is allowed', () => {
  assert.equal(writeError(member, 'issues', [], hiddenRow, null), 'that row is not visible to you')
  assert.equal(writeError(member, 'issues', [], openRow, null), null)
})

test('creating a row in a granted project is allowed, unscoped guest issue is refused', () => {
  assert.equal(writeError(guest(['p1']), 'issues', ['title'], null, openRow), null)
  assert.equal(writeError(guest(['p1']), 'issues', ['title'], null, unscoped), 'guests can only edit issues and docs in their projects')
})

test('member management and role labels', () => {
  assert.equal(canManageMembers(owner), true)
  assert.equal(canManageMembers(member), false)
  assert.equal(roleLabel('viewer'), 'Viewer (read only)')
  assert.equal(roleLabel('guest'), 'Guest')
})

test('isProjectAccess accepts valid shapes and rejects invalid ones', () => {
  assert.equal(isProjectAccess({ mode: 'open', users: [] }), true)
  assert.equal(isProjectAccess({ mode: 'restricted', users: ['u1', 'u2'] }), true)
  assert.equal(isProjectAccess({ mode: 'restricted', users: Array(500).fill('u') }), true)
  assert.equal(isProjectAccess({ mode: 'private', users: [] }), false)
  assert.equal(isProjectAccess({ mode: 'open' }), false)
  assert.equal(isProjectAccess({ mode: 'restricted', users: ['u', ''] }), false)
  assert.equal(isProjectAccess({ mode: 'restricted', users: [1] }), false)
  assert.equal(isProjectAccess({ mode: 'restricted', users: Array(501).fill('u') }), false)
  assert.equal(isProjectAccess(null), false)
  assert.equal(isProjectAccess('open'), false)
})
