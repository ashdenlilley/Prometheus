import { categoryOf } from './model'
import type { AppData } from './types'

// Sub-issues whose status is completed or canceled count as done.
export function subtaskSummary(data: AppData, issueId: string): { done: number; total: number; ratio: number } {
  const subs = data.issues.filter(i => i.parentId === issueId)
  const done = subs.filter(i => {
    const c = categoryOf(data.projects.find(p => p.id === i.projectId), i.status)
    return c === 'completed' || c === 'canceled'
  }).length
  return { done, total: subs.length, ratio: subs.length ? done / subs.length : 0 }
}

export const subtaskLabel = (s: { done: number; total: number }) => (s.total ? `${s.done}/${s.total}` : '')
