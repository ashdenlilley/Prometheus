// Project activity log: every issue's history and comments merged newest first. Pure so the view and tests share it.
import { isLive } from './live'
import { issueKey } from './model'
import { toISO } from './dates'
import type { AppData } from './types'

export interface ActivityItem {
  at: string
  issueId: string
  key: string
  title: string
  text: string
  kind: 'activity' | 'comment'
  field?: string
}

// Activity text prefix to field name. Anything else is 'other'.
const FIELD_PREFIXES: [prefix: string, field: string][] = [
  ['Title:', 'title'],
  ['Status:', 'status'],
  ['Priority:', 'priority'],
  ['Assignee:', 'assignee'],
  ['Labels', 'labels'],
  ['Start:', 'start'],
  ['Due', 'due'],
  ['Estimate', 'estimate'],
  ['Cycle', 'cycle'],
  ['Milestone', 'milestone'],
  ['Parent', 'parent'],
  ['Description', 'description'],
  ['Created', 'created']
]

export const ACTIVITY_FIELDS = [...FIELD_PREFIXES.map(([, field]) => field), 'comment', 'other']

export function activityField(text: string): string {
  return FIELD_PREFIXES.find(([prefix]) => text.startsWith(prefix))?.[1] ?? 'other'
}

// `from` and `to` are inclusive YYYY-MM-DD bounds on the local calendar day shown to the user.
export function projectActivity(
  data: AppData,
  projectId: string,
  opts: { issueId?: string; field?: string; from?: string; to?: string }
): ActivityItem[] {
  const items = data.issues
    .filter(i => i.projectId === projectId && isLive(i) && (!opts.issueId || i.id === opts.issueId))
    .flatMap(issue => {
      const base = { issueId: issue.id, key: issueKey(data, issue), title: issue.title }
      return [
        ...issue.activity.map(a => ({ ...base, at: a.at, text: a.text, kind: 'activity' as const, field: activityField(a.text) })),
        ...issue.comments.map(c => ({ ...base, at: c.at, text: `${c.author}: ${c.body.slice(0, 80)}`, kind: 'comment' as const, field: 'comment' }))
      ]
    })
  return items
    .filter(e => {
      const day = toISO(new Date(e.at))
      return (!opts.field || e.field === opts.field) && (!opts.from || day >= opts.from) && (!opts.to || day <= opts.to)
    })
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

// One 0-based page of a list. Callers clamp pageIndex to the last page.
export function page<T>(items: T[], pageIndex: number, size: number): T[] {
  return items.slice(pageIndex * size, (pageIndex + 1) * size)
}
