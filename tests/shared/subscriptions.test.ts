import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createIssue, reducer } from '../../src/shared/model'
import { subscriptionNotifications } from '../../src/shared/subscriptions'
import { blankProject, emptyData } from '../../src/shared/seed'
import type { AppData, Issue } from '../../src/shared/types'

const project = (patch: Partial<ReturnType<typeof blankProject>> = {}) =>
  blankProject({ id: 'p1', spaceId: 's1', name: 'Test', key: 'T', color: '#000000', ...patch })

const base = (issue: Partial<Issue> = {}): AppData => ({
  ...emptyData(),
  me: 'Ada',
  projects: [project()],
  issues: [createIssue(emptyData(), 'p1', 'Login', { id: 'i1', number: 1, subscribed: true, status: 'backlog', priority: 3, assignee: 'Ada', ...issue })]
})

// Applies a change to issue i1 in a copy of the data, the way a remote edit would arrive.
const change = (data: AppData, patch: Partial<Issue>): AppData => ({
  ...data,
  issues: data.issues.map(i => (i.id === 'i1' ? { ...i, ...patch } : i))
})

const texts = (d: AppData) => d.notifications.map(n => n.text)

describe('subscriptionNotifications', () => {
  test('status, priority and assignee changes each notify, labelled with the source', () => {
    const prev = base()
    const next = change(prev, { status: 'started', priority: 1, assignee: 'Grace' })
    const out = subscriptionNotifications(prev, next, 'sync')
    assert.deepEqual(texts(out), [
      'T-1 status: Backlog → started (via sync)',
      'T-1 priority: Medium → Urgent (via sync)',
      'T-1 assignee: Ada → Grace (via sync)'
    ])
    assert.ok(out.notifications.every(n => n.issueId === 'i1' && n.read === false && n.id && n.at))
  })

  test('status label is used when the project defines one', () => {
    const prev = base()
    prev.projects = [project({ statuses: [{ id: 'backlog', label: 'Backlog', color: '#000', category: 'backlog' }, { id: 'started', label: 'In progress', color: '#000', category: 'started' }] })]
    const next = change(prev, { status: 'started' })
    assert.deepEqual(texts(subscriptionNotifications(prev, next, 'MCP')), ['T-1 status: Backlog → In progress (via MCP)'])
  })

  test('new comments from others notify, but the local user’s own comments do not', () => {
    const prev = base()
    const mine = { id: 'c1', author: 'Ada', body: 'me', at: '2026-10-29T00:00:00Z' }
    const theirs = { id: 'c2', author: 'Grace', body: 'hi', at: '2026-10-29T00:01:00Z' }
    const out = subscriptionNotifications(prev, change(prev, { comments: [mine, theirs] }), 'sync')
    assert.deepEqual(texts(out), ['Grace commented on T-1 (via sync)'])
  })

  test('unsubscribed issues are silent', () => {
    const prev = base({ subscribed: false })
    const next = change(prev, { status: 'done', priority: 0 })
    assert.equal(subscriptionNotifications(prev, next, 'sync'), next)
  })

  test('issues that did not exist before are silent', () => {
    const prev = { ...base(), issues: [] }
    const next = base({ title: 'New' })
    assert.equal(subscriptionNotifications(prev, next, 'sync'), next)
  })

  test('returns the same reference when nothing relevant changed', () => {
    const prev = base()
    const next = change(prev, { title: 'Renamed' })
    assert.equal(subscriptionNotifications(prev, next, 'sync'), next)
  })

  test('caps the notification list at 200, newest first', () => {
    const prev = base()
    const many = Array.from({ length: 199 }, (_, n) => ({ id: `old${n}`, at: '2026-01-01T00:00:00Z', text: 'old', read: true }))
    const seeded = { ...prev, notifications: many }
    const next = change(seeded, { status: 'started' })
    const out = subscriptionNotifications(seeded, next, 'sync')
    assert.equal(out.notifications.length, 200)
    assert.equal(out.notifications[0].text, 'T-1 status: Backlog → started (via sync)')
  })
})

describe('auto-subscribe on create', () => {
  const fresh = (): AppData => ({ ...emptyData(), me: 'Ada', projects: [project()] })

  test('addIssue subscribes a new issue by default', () => {
    const out = reducer(fresh(), { type: 'addIssue', issue: createIssue(fresh(), 'p1', 'Login') })
    assert.equal(out.issues[0].subscribed, true)
  })

  test('addIssues subscribes each new issue by default', () => {
    const d = fresh()
    const out = reducer(d, { type: 'addIssues', issues: [createIssue(d, 'p1', 'A'), createIssue(d, 'p1', 'B')] })
    assert.deepEqual(out.issues.map(i => i.subscribed), [true, true])
  })

  test('a project with autoSubscribe off creates unsubscribed issues', () => {
    const d = { ...fresh(), projects: [project({ autoSubscribe: false })] }
    assert.equal(reducer(d, { type: 'addIssue', issue: createIssue(d, 'p1', 'A') }).issues[0].subscribed, undefined)
    assert.equal(reducer(d, { type: 'addIssues', issues: [createIssue(d, 'p1', 'B')] }).issues[0].subscribed, undefined)
  })

  test('an explicit subscribed value on the new issue is kept', () => {
    const d = { ...fresh(), projects: [project({ autoSubscribe: false })] }
    const out = reducer(d, { type: 'addIssue', issue: createIssue(d, 'p1', 'A', { subscribed: true }) })
    assert.equal(out.issues[0].subscribed, true)
  })

  test('old issues without the field are not subscribed', () => {
    const d = base({ subscribed: undefined })
    assert.equal(d.issues[0].subscribed, undefined)
    assert.equal(subscriptionNotifications(d, change(d, { status: 'done' }), 'sync').notifications.length, 0)
  })
})
