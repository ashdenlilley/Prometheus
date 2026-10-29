import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { PROVIDER_LABELS, linkUrls, offersPostSlack, scopeLabel } from '../../src/shared/integrations'
import { emptyData } from '../../src/shared/seed'
import type { AutomationTrigger, Integration, LinkProvider } from '../../src/shared/types'

const int = (scope: Integration['scope'], scopeId: string): Integration => ({
  id: 'i1',
  provider: 'slack',
  name: 'Team',
  scope,
  scopeId,
  settings: {},
  createdAt: '2026-10-01T00:00:00.000Z'
})

describe('integration UI helpers', () => {
  test('scopeLabel names the space or project, or says it was deleted', () => {
    const data = { ...emptyData(), spaces: [{ id: 's1', name: 'Platform' }], projects: [{ id: 'p1', name: 'Web' }] } as never
    assert.equal(scopeLabel(data, int('space', 's1')), 'Platform')
    assert.equal(scopeLabel(data, int('project', 'p1')), 'Web')
    assert.equal(scopeLabel(data, int('project', 'gone')), 'Deleted')
  })

  test('post to Slack is offered for issue triggers only', () => {
    const issueTriggers: AutomationTrigger['type'][] = ['status_changed', 'priority_changed', 'assignee_changed', 'due_passed', 'column_changed']
    const objectTriggers: AutomationTrigger['type'][] = ['project_status_changed', 'cycle_started', 'cycle_ended', 'initiative_status_changed']
    for (const t of issueTriggers) assert.equal(offersPostSlack(t), true, t)
    for (const t of objectTriggers) assert.equal(offersPostSlack(t), false, t)
  })

  test('every provider has a label', () => {
    const providers: LinkProvider[] = ['slack', 'figma', 'sentry', 'zendesk', 'jira', 'google', 'teams', 'github', 'other']
    for (const p of providers) assert.ok(PROVIDER_LABELS[p], p)
  })

  test('linkUrls reads urls from a link list and ignores other values', () => {
    assert.deepEqual(linkUrls([{ url: 'https://a.test/x', provider: 'other' }, { url: 'https://b.test', provider: 'figma' }]), ['https://a.test/x', 'https://b.test'])
    assert.deepEqual(linkUrls('plain text'), [])
    assert.deepEqual(linkUrls(undefined), [])
  })
})
