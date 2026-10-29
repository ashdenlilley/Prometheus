import { issueKey } from './model'
import { PRIORITIES, type AppData, type Notification } from './types'

const CAP = 200

// Notifications for changes made elsewhere (sync, MCP) to issues this device follows.
// The user's own UI edits go through data:save and never reach here.
export function subscriptionNotifications(prev: AppData, next: AppData, source: string): AppData {
  const at = new Date().toISOString()
  const out: Notification[] = []
  for (const issue of next.issues) {
    if (issue.subscribed !== true) continue
    const old = prev.issues.find(i => i.id === issue.id)
    if (!old) continue
    const key = issueKey(next, issue)
    const add = (text: string) => out.push({ id: crypto.randomUUID(), at, text: `${text} (via ${source})`, issueId: issue.id, read: false })
    if (old.status !== issue.status) {
      const project = next.projects.find(p => p.id === issue.projectId)
      const label = (id: string) => project?.statuses.find(s => s.id === id)?.label ?? id
      add(`${key} status: ${label(old.status)} → ${label(issue.status)}`)
    }
    if (old.priority !== issue.priority) add(`${key} priority: ${PRIORITIES[old.priority]} → ${PRIORITIES[issue.priority]}`)
    if (old.assignee !== issue.assignee) add(`${key} assignee: ${old.assignee || 'none'} → ${issue.assignee || 'none'}`)
    const seen = new Set(old.comments.map(c => c.id))
    for (const c of [...issue.comments].reverse()) {
      if (!seen.has(c.id) && c.author !== next.me) add(`${c.author} commented on ${key}`)
    }
  }
  if (out.length === 0) return next
  return { ...next, notifications: [...out, ...next.notifications].slice(0, CAP) }
}
