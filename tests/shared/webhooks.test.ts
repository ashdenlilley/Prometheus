import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createIssue, reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import { nextAttemptAt, RETRY_DELAYS_MS, urlAllowed, webhookEvents } from '../../src/shared/webhooks'
import type { AppData, Webhook } from '../../src/shared/types'

const at = '2026-10-30T00:00:00.000Z'

function hook(patch: Partial<Webhook> = {}): Webhook {
  return { id: 'wh-1', projectId: 'proj-1', url: 'https://example.com/hook', events: ['issue.created', 'issue.updated', 'issue.deleted', 'issue.status_changed', 'comment.created'], enabled: true, createdAt: at, ...patch }
}

// One project PRM with one issue PRM-1 (status backlog).
function base(): AppData {
  const data = emptyData()
  data.spaces.push({ id: 'space-1', name: 'Work', color: '#5e6ad2' })
  data.projects.push(blankProject({ id: 'proj-1', spaceId: 'space-1', name: 'Prometheus', key: 'PRM', color: '#5e6ad2' }))
  data.issues.push({ ...createIssue(data, 'proj-1', 'First'), id: 'issue-1' })
  return data
}

describe('nextAttemptAt', () => {
  test('follows the retry schedule from the time of the failure', () => {
    assert.deepEqual(RETRY_DELAYS_MS, [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000])
    assert.equal(nextAttemptAt(1, 1000), 1000 + 60_000)
    assert.equal(nextAttemptAt(2, 1000), 1000 + 300_000)
    assert.equal(nextAttemptAt(5, 1000), 1000 + 21_600_000)
  })

  test('returns null once the schedule is used up', () => {
    assert.equal(nextAttemptAt(6, 0), null)
    assert.equal(nextAttemptAt(0, 0), null)
  })
})

describe('urlAllowed', () => {
  test('allows https to public hosts', () => {
    assert.deepEqual(urlAllowed('https://example.com/hook'), { ok: true })
    assert.deepEqual(urlAllowed('https://8.8.8.8/hook'), { ok: true })
    assert.deepEqual(urlAllowed('https://172.32.0.1/hook'), { ok: true })
  })

  test('refuses plain http to public hosts', () => {
    assert.equal(urlAllowed('http://example.com/hook').ok, false)
    assert.equal(urlAllowed('http://example.com/hook', true).ok, false)
  })

  test('refuses private, loopback and link-local literals without allowLocal', () => {
    for (const url of [
      'https://10.1.2.3/',
      'https://172.16.0.1/',
      'https://172.31.255.255/',
      'https://192.168.1.1/',
      'https://127.0.0.2/',
      'https://169.254.10.10/',
      'https://localhost/',
      'https://[::1]/',
      'https://[fc00::1]/',
      'https://[fd12:3456::1]/',
      'https://[fe80::1]/'
    ]) {
      assert.equal(urlAllowed(url).ok, false, url)
    }
  })

  test('allows private hosts with allowLocal, and http only for loopback', () => {
    assert.deepEqual(urlAllowed('https://192.168.1.1/', true), { ok: true })
    assert.deepEqual(urlAllowed('http://localhost:4000/hook', true), { ok: true })
    assert.deepEqual(urlAllowed('http://127.0.0.1:4000/hook', true), { ok: true })
    assert.deepEqual(urlAllowed('http://[::1]:4000/hook', true), { ok: true })
    assert.equal(urlAllowed('http://192.168.1.1/', true).ok, false)
  })

  test('refuses other schemes and malformed URLs', () => {
    assert.equal(urlAllowed('ftp://example.com/').ok, false)
    assert.equal(urlAllowed('not a url').ok, false)
  })
})

describe('webhookEvents', () => {
  test('a new issue fires issue.created', () => {
    const prev = base()
    const next = { ...prev, webhooks: [hook()], issues: [...prev.issues, { ...createIssue(prev, 'proj-1', 'New'), id: 'issue-2' }] }
    const out = webhookEvents(prev, next, 'me', at)
    assert.deepEqual(out.map(o => [o.webhookId, o.event]), [['wh-1', 'issue.created']])
    assert.equal(out[0].payload.issue?.id, 'issue-2')
    assert.deepEqual(out[0].payload.project, { id: 'proj-1', key: 'PRM' })
    assert.equal(out[0].payload.actor, 'me')
    assert.equal(out[0].payload.at, at)
  })

  test('an edit fires issue.updated with the changed fields, ignoring activity and updatedAt', () => {
    const prev = base()
    const changed = { ...prev.issues[0], title: 'Renamed', priority: 2, updatedAt: at, activity: [{ id: 'a', at, text: 'x' }] }
    const out = webhookEvents(prev, { ...prev, webhooks: [hook()], issues: [changed] }, 'mcp', at)
    assert.deepEqual(out.map(o => o.event), ['issue.updated'])
    assert.deepEqual(out[0].payload.changes, { title: ['First', 'Renamed'], priority: [0, 2] })
  })

  test('a status change also fires issue.status_changed', () => {
    const prev = base()
    const changed = { ...prev.issues[0], status: 'done' }
    const out = webhookEvents(prev, { ...prev, webhooks: [hook()], issues: [changed] }, 'mcp', at)
    assert.deepEqual(out.map(o => o.event), ['issue.updated', 'issue.status_changed'])
    assert.deepEqual(out[1].payload.changes, { status: ['backlog', 'done'] })
  })

  test('no change, no events', () => {
    const prev = base()
    assert.deepEqual(webhookEvents(prev, { ...prev, webhooks: [hook()] }, 'me', at), [])
  })

  test('a removed issue fires issue.deleted with the old issue', () => {
    const prev = base()
    const out = webhookEvents(prev, { ...prev, webhooks: [hook()], issues: [] }, 'me', at)
    assert.deepEqual(out.map(o => o.event), ['issue.deleted'])
    assert.equal(out[0].payload.issue?.id, 'issue-1')
  })

  test('new comments fire comment.created with the comment in the payload', () => {
    const prev = base()
    const comment = { id: 'c-1', author: 'Ashden', body: 'Hi', at }
    const changed = { ...prev.issues[0], comments: [comment] }
    const out = webhookEvents(prev, { ...prev, webhooks: [hook()], issues: [changed] }, 'me', at)
    const comments = out.filter(o => o.event === 'comment.created')
    assert.equal(comments.length, 1)
    assert.deepEqual(comments[0].payload.comment, comment)
    // Comments are not reported as a field change.
    assert.equal(out.find(o => o.event === 'issue.updated'), undefined)
  })

  test('only enabled webhooks for the issue project that subscribe to the event get an entry', () => {
    const prev = base()
    const next = {
      ...prev,
      webhooks: [
        hook({ id: 'on', events: ['issue.updated'] }),
        hook({ id: 'off', enabled: false }),
        hook({ id: 'other-project', projectId: 'proj-2' }),
        hook({ id: 'not-subscribed', events: ['comment.created'] })
      ],
      issues: [{ ...prev.issues[0], title: 'Renamed' }]
    }
    const out = webhookEvents(prev, next, 'me', at)
    assert.deepEqual(out.map(o => o.webhookId), ['on'])
  })

  test('no webhooks configured gives no entries', () => {
    const prev = base()
    assert.deepEqual(webhookEvents(prev, { ...prev, issues: [] }, 'me', at), [])
  })
})

describe('webhook reducer actions', () => {
  test('addWebhook, patchWebhook and deleteWebhook work on data without the optional array', () => {
    const data = base()
    assert.equal(data.webhooks, undefined)
    const added = reducer(data, { type: 'addWebhook', webhook: hook() })
    assert.deepEqual(added.webhooks, [hook()])
    const patched = reducer(added, { type: 'patchWebhook', id: 'wh-1', patch: { enabled: false, disabledReason: 'Receiver returned 410' } })
    assert.equal(patched.webhooks?.[0].enabled, false)
    assert.equal(patched.webhooks?.[0].disabledReason, 'Receiver returned 410')
    assert.equal(patched.webhooks?.[0].url, 'https://example.com/hook')
    const deleted = reducer(patched, { type: 'deleteWebhook', id: 'wh-1' })
    assert.deepEqual(deleted.webhooks, [])
  })
})
