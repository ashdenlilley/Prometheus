import type { AppData, AutomationTrigger, Integration, Issue, IntegrationLink, LinkProvider } from './types'
import { PRIORITIES } from './types'
import { issueKey, statusLabel } from './model'

// Pure helpers for integrations: link detection, the Slack webhook policy and message building. No node imports.

export type SlackBlock = Record<string, unknown>
export interface SlackMessage {
  text: string
  blocks: SlackBlock[]
}

export function detectProvider(url: string): LinkProvider {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return 'other'
  }
  const under = (domain: string) => host === domain || host.endsWith(`.${domain}`)
  if (under('slack.com')) return 'slack'
  if (host === 'figma.com' || host === 'www.figma.com') return 'figma'
  if (under('sentry.io')) return 'sentry'
  if (under('zendesk.com')) return 'zendesk'
  if (under('atlassian.net')) return 'jira'
  if (under('google.com')) return 'google'
  if (host === 'teams.microsoft.com' || host === 'teams.live.com') return 'teams'
  if (host === 'github.com') return 'github'
  return 'other'
}

// Null unless the text is an http(s) URL. The title is the host plus the last path segment.
export function parseIntegrationLink(text: string): IntegrationLink | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const last = url.pathname.split('/').filter(Boolean).pop()
  return { url: url.href, provider: detectProvider(url.href), title: last ? `${url.hostname} / ${last}` : url.hostname }
}

// The only outgoing URL policy for Slack: https://hooks.slack.com/{services,workflows,triggers}/...
export function isSlackWebhookUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  return (
    u.protocol === 'https:' &&
    u.hostname === 'hooks.slack.com' &&
    u.port === '' &&
    !u.username &&
    !u.password &&
    /^\/(services|workflows|triggers)\//.test(u.pathname)
  )
}

// Slack mrkdwn treats &, < and > specially, so escaping them makes <!channel> or <@U123> inert.
export function escapeMrkdwn(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Block Kit message for one issue. With a template, {key} {title} {status} {assignee} {project} are replaced
// by escaped values; the template text itself is kept as written.
export function slackMessage(data: AppData, issue: Issue, opts: { reason?: string; template?: string } = {}): SlackMessage {
  const project = data.projects.find(p => p.id === issue.projectId)
  const values = {
    key: escapeMrkdwn(issueKey(data, issue)),
    title: escapeMrkdwn(issue.title),
    status: escapeMrkdwn(statusLabel(project, issue.status)),
    assignee: escapeMrkdwn(issue.assignee || 'Unassigned'),
    project: escapeMrkdwn(project?.name ?? '')
  }
  const headline = opts.template
    ? opts.template.replace(/\{(key|title|status|assignee|project)\}/g, (_, k: keyof typeof values) => values[k])
    : `*${values.key}* ${values.title}`
  const fields = [
    `Status: ${values.status}`,
    `Priority: ${escapeMrkdwn(PRIORITIES[issue.priority] ?? 'No priority')}`,
    `Assignee: ${values.assignee}`,
    `Project: ${values.project}`,
    opts.reason ? escapeMrkdwn(opts.reason) : ''
  ].filter(Boolean)
  return {
    text: opts.template ? headline : `${values.key} ${values.title}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: headline } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: fields.join(' · ') }] }
    ]
  }
}

export const PROVIDER_LABELS: Record<LinkProvider, string> = {
  slack: 'Slack',
  figma: 'Figma',
  sentry: 'Sentry',
  zendesk: 'Zendesk',
  jira: 'Jira',
  google: 'Google',
  teams: 'Microsoft Teams',
  github: 'GitHub',
  other: 'Link'
}

// The space or project a connection is scoped to, for display. Falls back when the target was deleted.
export function scopeLabel(data: AppData, integration: Integration): string {
  const name =
    integration.scope === 'space'
      ? data.spaces.find(s => s.id === integration.scopeId)?.name
      : data.projects.find(p => p.id === integration.scopeId)?.name
  return name ?? 'Deleted'
}

// Object triggers act on sets of issues. The backend skips post_slack for them, so the editor does not offer it.
export const OBJECT_TRIGGERS: AutomationTrigger['type'][] = ['project_status_changed', 'cycle_started', 'cycle_ended', 'initiative_status_changed']
export const offersPostSlack = (trigger: AutomationTrigger['type']) => !OBJECT_TRIGGERS.includes(trigger)

// URLs of an 'integrations' cell, for sorting. Anything that is not a link list reads as empty.
export function linkUrls(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap(l => (typeof l === 'object' && l !== null && 'url' in l ? [String(l.url)] : [])) : []
}

export function integrationsFor(data: AppData, projectId: string): Integration[] {
  const spaceId = data.projects.find(p => p.id === projectId)?.spaceId
  return (data.integrations ?? []).filter(
    i => (i.scope === 'project' && i.scopeId === projectId) || (i.scope === 'space' && i.scopeId === spaceId)
  )
}

// Pending posts are never persisted or synced: saves, snapshots and undo history all drop them.
export function stripPendingPosts(data: AppData): AppData {
  if (!('pendingPosts' in data)) return data
  const { pendingPosts: _dropped, ...rest } = data
  return rest as AppData
}
