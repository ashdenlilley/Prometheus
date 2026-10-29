import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opsError } from '../../src/shared/opGuard'
import { blankProject, emptyData } from '../../src/shared/seed'
import { Clock, diffOps } from '../../src/shared/sync'
import type { ColumnAccess, Column, Issue, Project, AppData } from '../../src/shared/types'
import type { Principal } from '../../src/shared/permissions'

const owner: Principal = { userId: 'o', role: 'owner', projects: [] }
const member: Principal = { userId: 'u1', role: 'member', projects: [] }
const viewer: Principal = { userId: 'v', role: 'viewer', projects: [] }
const guest: Principal = { userId: 'g', role: 'guest', projects: ['p1'] }

const proj = (over: Partial<Project> = {}) => blankProject({ id: 'p1', spaceId: 's1', name: 'P', key: 'P', color: '#000', ...over })
const col = (id: string, access?: ColumnAccess): Column => ({ id, name: id, type: 'text', access })
const issue = (over: Partial<Issue> = {}): Issue => ({
  id: 'i1', projectId: 'p1', number: 1, title: 't', description: '', status: 'todo', priority: 0, assignee: '',
  labels: [], relations: [], comments: [], activity: [], values: {}, createdAt: '', updatedAt: '', ...over
})
const world = (issues: Issue[] = [], projects: Project[] = [proj()]): AppData => ({ ...emptyData(), projects, issues })
const ops = (prev: AppData, next: AppData) => diffOps(prev, next, new Clock('t'))

test('owner is never refused', () => {
  const prev = world([issue()])
  const next = world([issue({ title: 'x', values: { c: 1 } })])
  assert.equal(opsError(owner, prev, ops(prev, next)), null)
})

test('viewers cannot create issues', () => {
  const prev = world()
  const next = world([issue()])
  assert.equal(opsError(viewer, prev, ops(prev, next)), 'Not allowed: viewers have read-only access')
})

test('members cannot edit read-only column values, but can edit plain ones', () => {
  const projects = [proj({ columns: [col('ro', { readOnlyFor: ['member'] }), col('plain')] })]
  const prev = world([issue({ values: { ro: 1, plain: 'a' } })], projects)
  const bad = world([issue({ values: { ro: 2, plain: 'a' } })], projects)
  const good = world([issue({ values: { ro: 1, plain: 'b' } })], projects)
  assert.equal(opsError(member, prev, ops(prev, bad)), 'Not allowed: the ro column is read-only for members')
  assert.equal(opsError(member, prev, ops(prev, good)), null)
})

test('members cannot write hidden columns', () => {
  const projects = [proj({ columns: [col('secret', { hiddenFor: ['member'] })] })]
  const prev = world([issue({ values: { secret: 'x' } })], projects)
  const next = world([issue({ values: { secret: 'y' } })], projects)
  assert.equal(opsError(member, prev, ops(prev, next)), 'Not allowed: the secret column is hidden from members')
})

test('members cannot change a restricted column\'s access', () => {
  const prev = world([], [proj({ columns: [col('ro', { readOnlyFor: ['member'] })] })])
  const next = world([], [proj({ columns: [col('ro', { readOnlyFor: ['member', 'guest'] })] })])
  assert.equal(opsError(member, prev, ops(prev, next)), 'Not allowed: only the owner can change column permissions or restricted columns')
})

test('guests edit issues only in their projects', () => {
  const projects = [proj({ id: 'p1' }), proj({ id: 'p2' })]
  const prev = world([issue({ id: 'i1', projectId: 'p2' })], projects)
  const outside = world([issue({ id: 'i1', projectId: 'p2', title: 'x' })], projects)
  assert.equal(opsError(guest, prev, ops(prev, outside)), 'Not allowed: that row is not visible to you')
  const prevIn = world([issue({ id: 'i1', projectId: 'p1' })], projects)
  const inside = world([issue({ id: 'i1', projectId: 'p1', title: 'x' })], projects)
  assert.equal(opsError(guest, prevIn, ops(prevIn, inside)), null)
})

test('members cannot edit issues in a restricted project that does not list them', () => {
  const prev = world([issue()], [proj({ access: { mode: 'restricted', users: ['someone-else'] } })])
  const next = world([issue({ title: 'x' })], [proj({ access: { mode: 'restricted', users: ['someone-else'] } })])
  assert.equal(opsError(member, prev, ops(prev, next)), 'Not allowed: that row is not visible to you')
})
