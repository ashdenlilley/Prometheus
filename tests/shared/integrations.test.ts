import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createIssue, reducer } from '../../src/shared/model'
import { blankProject, emptyData } from '../../src/shared/seed'
import { detectProvider, escapeMrkdwn, integrationsFor, isSlackWebhookUrl, parseIntegrationLink, slackMessage, stripPendingPosts } from '../../src/shared/integrations'
import { emptyHistory, withUndo } from '../../src/shared/history'
import { Clock, diffOps } from '../../src/shared/sync'
import type { Automation, AppData, Integration, Project } from '../../src/shared/types'

const proj = (id: string, spaceId: string, extra: Partial<Project> = {}) => blankProject({ id, spaceId, name: id, key: id.toUpperCase(), color: '#000000', ...extra })
const slackInt = (id: string, scope: Integration['scope'], scopeId: string): Integration => ({
  id,
  provider: 'slack',
  name: `Team ${id}`,
  scope,
  scopeId,
  settings: {},
  createdAt: '2026-10-01T00:00:00.000Z'
})
const rule = (id: string, integrationId: string, extra: Partial<Automation> = {}): Automation => ({
  id,
  projectId: 'p1',
  name: `Rule ${id}`,
  enabled: true,
  trigger: { type: 'status_changed', to: 'done' },
  action: { type: 'post_slack', integrationId },
  ...extra
})
// Two projects in space s1 and an issue i1 in p1.
const base = (): AppData => ({
  ...emptyData(),
  projects: [proj('p1', 's1'), proj('p2', 's1')],
  issues: [createIssue(emptyData(), 'p1', 'Source', { id: 'i1', number: 1 })]
})
const finish = (s: AppData) => reducer(s, { type: 'patchIssue', id: 'i1', patch: { status: 'done' } })
const issue = (s: AppData, id = 'i1') => s.issues.find(i => i.id === id)!

describe('detectProvider', () => {
  test('maps each provider by hostname', () => {
    assert.equal(detectProvider('https://acme.slack.com/archives/C1'), 'slack')
    assert.equal(detectProvider('https://www.figma.com/file/abc'), 'figma')
    assert.equal(detectProvider('https://figma.com/file/abc'), 'figma')
    assert.equal(detectProvider('https://acme.sentry.io/issues/1'), 'sentry')
    assert.equal(detectProvider('https://sentry.io/x'), 'sentry')
    assert.equal(detectProvider('https://acme.zendesk.com/agent/tickets/3'), 'zendesk')
    assert.equal(detectProvider('https://acme.atlassian.net/browse/OS-1'), 'jira')
    assert.equal(detectProvider('https://docs.google.com/document/d/1'), 'google')
    assert.equal(detectProvider('https://drive.google.com/file/d/1'), 'google')
    assert.equal(detectProvider('https://mail.google.com/mail'), 'google')
    assert.equal(detectProvider('https://teams.microsoft.com/l/chat'), 'teams')
    assert.equal(detectProvider('https://teams.live.com/meet/1'), 'teams')
    assert.equal(detectProvider('https://github.com/a/b'), 'github')
  })

  test('other hosts, including look-alikes, are other', () => {
    assert.equal(detectProvider('https://example.com/slack.com'), 'other')
    assert.equal(detectProvider('https://slack.com.evil.io/x'), 'other')
    assert.equal(detectProvider('https://notfigma.com/x'), 'other')
    assert.equal(detectProvider('https://gist.github.com/x'), 'other')
  })

  test('invalid URLs are other', () => {
    assert.equal(detectProvider('not a url'), 'other')
    assert.equal(detectProvider(''), 'other')
  })
})

describe('parseIntegrationLink', () => {
  test('returns the link with provider and a readable title', () => {
    assert.deepEqual(parseIntegrationLink(' https://github.com/acme/app/pull/12 '), {
      url: 'https://github.com/acme/app/pull/12',
      provider: 'github',
      title: 'github.com / 12'
    })
    assert.equal(parseIntegrationLink('https://example.com')?.title, 'example.com')
  })

  test('rejects invalid and non-http URLs', () => {
    assert.equal(parseIntegrationLink('hello'), null)
    assert.equal(parseIntegrationLink('javascript:alert(1)'), null)
    assert.equal(parseIntegrationLink('file:///etc/passwd'), null)
  })
})

describe('isSlackWebhookUrl', () => {
  const ok = 'https://hooks.slack.com/services/T000/B000/abcd1234'

  test('accepts hooks.slack.com paths for services, workflows and triggers', () => {
    assert.equal(isSlackWebhookUrl(ok), true)
    assert.equal(isSlackWebhookUrl('https://hooks.slack.com/workflows/T1/A1/2/abc'), true)
    assert.equal(isSlackWebhookUrl('https://hooks.slack.com/triggers/T1/2/abc'), true)
  })

  test('rejects other schemes, hosts, ports, userinfo and paths', () => {
    assert.equal(isSlackWebhookUrl(ok.replace('https', 'http')), false)
    assert.equal(isSlackWebhookUrl('https://hooks.slack.com.evil.com/services/T/B/x'), false)
    assert.equal(isSlackWebhookUrl('https://evil.com/hooks.slack.com/services/T/B/x'), false)
    assert.equal(isSlackWebhookUrl('https://user:pw@hooks.slack.com/services/T/B/x'), false)
    assert.equal(isSlackWebhookUrl('https://user@hooks.slack.com/services/T/B/x'), false)
    assert.equal(isSlackWebhookUrl('https://hooks.slack.com:8443/services/T/B/x'), false)
    assert.equal(isSlackWebhookUrl('https://hooks.slack.com/api/chat.postMessage'), false)
    assert.equal(isSlackWebhookUrl('not a url'), false)
  })
})

describe('escapeMrkdwn', () => {
  test('escapes &, < and > so mentions and links are inert', () => {
    assert.equal(escapeMrkdwn('<!channel> hi <@U123> <http://x|y>'), '&lt;!channel&gt; hi &lt;@U123&gt; &lt;http://x|y&gt;')
    assert.equal(escapeMrkdwn('a & b &amp;'), 'a &amp; b &amp;amp;')
  })

  test('strips control characters but keeps newlines and tabs', () => {
    assert.equal(escapeMrkdwn('a\u0000b\u0007c\u001bd\ne\tf'), 'abcd\ne\tf')
  })
})

describe('slackMessage', () => {
  const data = (): AppData => {
    const s = base()
    const project = s.projects.find(p => p.id === 'p1')!
    return { ...s, projects: s.projects.map(p => (p.id === project.id ? { ...project, name: 'Launch' } : p)) }
  }

  test('builds a section and a context block with the issue fields', () => {
    const s = data()
    const i = { ...issue(s), title: 'Ship it', assignee: 'Sam', priority: 2 }
    const msg = slackMessage(s, i, { reason: 'Shared' })
    assert.equal(msg.text, 'P1-1 Ship it')
    assert.deepEqual(msg.blocks[0], { type: 'section', text: { type: 'mrkdwn', text: '*P1-1* Ship it' } })
    const ctx = msg.blocks[1] as { type: string; elements: { text: string }[] }
    assert.equal(ctx.type, 'context')
    assert.equal(ctx.elements[0].text, 'Status: Backlog · Priority: High · Assignee: Sam · Project: Launch · Shared')
  })

  test('uses the team key when the issue stores one, and Unassigned when empty', () => {
    const s = data()
    const i = { ...issue(s), key: 'OPS', number: 42, title: 'x' }
    const msg = slackMessage(s, i)
    const ctx = msg.blocks[1] as { elements: { text: string }[] }
    assert.match(ctx.elements[0].text, /Assignee: Unassigned/)
    assert.equal(msg.text, 'OPS-42 x')
  })

  test('template replaces the headline with escaped values', () => {
    const s = data()
    const i = { ...issue(s), title: '<!channel> hi', assignee: '<@U1>' }
    const msg = slackMessage(s, i, { template: '{key}: {title} ({assignee}, {status}, {project})' })
    assert.equal(msg.text, 'P1-1: &lt;!channel&gt; hi (&lt;@U1&gt;, Backlog, Launch)')
    assert.equal((msg.blocks[0] as { text: { text: string } }).text.text, msg.text)
  })

  test('escapes a malicious title in the default headline', () => {
    const s = data()
    const msg = slackMessage(s, { ...issue(s), title: '<!channel> hi <@U1>' })
    assert.equal((msg.blocks[0] as { text: { text: string } }).text.text, '*P1-1* &lt;!channel&gt; hi &lt;@U1&gt;')
  })
})

describe('integrationsFor', () => {
  test('returns project-scoped and space-scoped integrations only', () => {
    const s: AppData = {
      ...base(),
      integrations: [slackInt('a', 'project', 'p1'), slackInt('b', 'space', 's1'), slackInt('c', 'project', 'p2'), slackInt('d', 'space', 's2')]
    }
    assert.deepEqual(integrationsFor(s, 'p1').map(i => i.id), ['a', 'b'])
    assert.deepEqual(integrationsFor({ ...base() }, 'p1'), [])
  })
})

describe('integration reducer actions', () => {
  test('addIntegration and updateIntegration change name, scope and settings only', () => {
    let s = reducer(base(), { type: 'addIntegration', integration: slackInt('int1', 'project', 'p1') })
    assert.equal(s.integrations?.length, 1)
    s = reducer(s, { type: 'updateIntegration', id: 'int1', patch: { name: 'Eng', scope: 'space', scopeId: 's1', settings: { channel: '#eng' } } })
    assert.deepEqual(s.integrations![0], { ...slackInt('int1', 'space', 's1'), name: 'Eng', settings: { channel: '#eng' } })
  })

  test('removeIntegration disables rules that post to it, with a notice', () => {
    let s = reducer(base(), { type: 'addIntegration', integration: slackInt('int1', 'project', 'p1') })
    s = { ...s, automations: [rule('a1', 'int1'), rule('a2', 'other')] }
    s = reducer(s, { type: 'removeIntegration', id: 'int1' })
    assert.deepEqual(s.integrations, [])
    assert.equal(s.automations.find(a => a.id === 'a1')?.enabled, false)
    assert.equal(s.automations.find(a => a.id === 'a2')?.enabled, true)
    assert.match(s.notifications[0].text, /Rule a1" was disabled: its Slack integration was removed/)
  })

  test('a rule posts once per firing and the post waits as a pending post', () => {
    let s = reducer(base(), { type: 'addIntegration', integration: slackInt('int1', 'project', 'p1') })
    s = { ...s, automations: [rule('a1', 'int1')] }
    s = finish(s)
    assert.equal(s.pendingPosts?.length, 1)
    const post = s.pendingPosts![0]
    assert.deepEqual([post.integrationId, post.issueId, post.reason], ['int1', 'i1', 'Automation "Rule a1"'])
    assert.match(issue(s).activity.at(-1)!.text, /Posted to Slack \(Team int1\) by automation Rule a1/)

    // Each firing queues one more post, and clearing removes only the drained ones
    s = reducer(s, { type: 'patchIssue', id: 'i1', patch: { status: 'backlog' } })
    s = finish(s)
    assert.equal(s.pendingPosts?.length, 2)
    s = reducer(s, { type: 'clearPendingPosts', ids: [post.id] })
    assert.equal(s.pendingPosts?.length, 1)
    s = reducer(s, { type: 'clearPendingPosts', ids: [s.pendingPosts![0].id] })
    assert.equal('pendingPosts' in s, false)
  })

  test('a rule whose integration is out of scope is disabled, not posted', () => {
    let s = reducer(base(), { type: 'addIntegration', integration: slackInt('int1', 'project', 'p2') })
    s = { ...s, automations: [rule('a1', 'int1')] }
    s = finish(s)
    assert.equal(s.pendingPosts, undefined)
    assert.equal(s.automations[0].enabled, false)
    assert.match(s.notifications[0].text, /missing or out of scope/)
  })

  test('shareToSlack queues a Shared post and respects scope', () => {
    let s = reducer(base(), { type: 'addIntegration', integration: slackInt('int1', 'space', 's1') })
    s = reducer(s, { type: 'shareToSlack', issueId: 'i1', integrationId: 'int1' })
    assert.deepEqual(s.pendingPosts?.map(p => [p.reason, p.issueId]), [['Shared', 'i1']])
    const outside = reducer(base(), { type: 'addIntegration', integration: slackInt('int2', 'project', 'p2') })
    assert.equal(reducer(outside, { type: 'shareToSlack', issueId: 'i1', integrationId: 'int2' }).pendingPosts, undefined)
  })

  test('integration links are added once, ignore invalid URLs and can be removed', () => {
    let s = base()
    s = reducer(s, { type: 'addIntegrationLink', issueId: 'i1', columnId: 'c1', url: 'https://github.com/a/b/pull/1' })
    s = reducer(s, { type: 'addIntegrationLink', issueId: 'i1', columnId: 'c1', url: 'https://github.com/a/b/pull/1' })
    s = reducer(s, { type: 'addIntegrationLink', issueId: 'i1', columnId: 'c1', url: 'javascript:alert(1)' })
    assert.deepEqual(issue(s).values.c1, [{ url: 'https://github.com/a/b/pull/1', provider: 'github', title: 'github.com / 1' }])
    s = reducer(s, { type: 'removeIntegrationLink', issueId: 'i1', columnId: 'c1', url: 'https://github.com/a/b/pull/1' })
    assert.equal(issue(s).values.c1, undefined)
  })

  test('pending posts are not undoable and create no sync ops', () => {
    const data = { ...base(), integrations: [slackInt('int1', 'space', 's1')] }
    const undoable = withUndo(reducer, () => 0)
    const after = undoable({ data, history: emptyHistory() }, { type: 'shareToSlack', issueId: 'i1', integrationId: 'int1' })
    assert.equal(after.history.past.length, 0)
    const ops = diffOps(data, after.data, new Clock('dev'))
    assert.equal(ops.some(o => o.table === 'issues' && o.set && 'pendingPosts' in o.set), false)
    assert.deepEqual(ops.filter(o => o.table === 'issues').map(o => o.id), ['i1']) // the activity entry only
  })

  test('stripPendingPosts drops the transient list and leaves the rest', () => {
    const s = { ...base(), pendingPosts: [{ id: 'p', integrationId: 'x', issueId: 'i1', reason: 'Shared', at: 'now' }] }
    const stripped = stripPendingPosts(s)
    assert.equal('pendingPosts' in stripped, false)
    assert.equal(stripped.issues.length, 1)
    assert.equal(stripPendingPosts(base()).projects.length, 2)
  })
})
