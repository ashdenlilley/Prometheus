import type { AppData, Cycle, Issue, ProjectStatus, ProjectUpdate, StatusDef } from './types'
import { isLive } from './live'
import { addDays, dayDiff } from './dates'
import { progress } from './query'

// Canceled issues are left out of both helpers. Dates are compared on their YYYY-MM-DD prefix.
const live = (issues: Issue[], statuses: StatusDef[]) => issues.filter(i => statuses.find(s => s.id === i.status)?.category !== 'canceled')

// One point per day from the cycle start to today (or the cycle end, if sooner). Empty before the cycle starts.
export function burndownSeries(cycle: Cycle, issues: Issue[], statuses: StatusDef[], today: string) {
  if (cycle.startDate > today) return []
  const pool = live(issues, statuses)
  const lastDay = today < cycle.endDate ? today : cycle.endDate
  const points: { day: string; scope: number; remaining: number }[] = []
  for (let n = 0; n <= dayDiff(cycle.startDate, lastDay); n++) {
    const day = addDays(cycle.startDate, n)
    const scoped = pool.filter(i => i.createdAt.slice(0, 10) <= day)
    points.push({ day, scope: scoped.length, remaining: scoped.filter(i => !i.completedAt || i.completedAt.slice(0, 10) > day).length })
  }
  return points
}

// Counts created and completed issues per bucket. Week buckets are 7 days from `from`; the last one is cut at `to`.
export function createdVsCompleted(issues: Issue[], from: string, to: string, bucket: 'day' | 'week') {
  const step = bucket === 'week' ? 7 : 1
  const rows: { start: string; created: number; completed: number }[] = []
  for (let start = from; start <= to; start = addDays(start, step)) {
    const end = addDays(start, step - 1) < to ? addDays(start, step - 1) : to
    const inBucket = (iso: string) => iso.slice(0, 10) >= start && iso.slice(0, 10) <= end
    rows.push({
      start,
      created: issues.filter(i => inBucket(i.createdAt)).length,
      completed: issues.filter(i => i.completedAt && inBucket(i.completedAt)).length
    })
  }
  return rows
}

export interface PortfolioRow {
  id: string
  name: string
  status: ProjectStatus
  lead: string
  pct: number
  targetDate?: string
  health?: ProjectUpdate['health']
}

// One row per project in the space, or just `projectId`. Health is from the latest update. Missing values stay undefined for the UI to show as dashes.
export function portfolioRows(data: AppData, spaceId: string, projectId?: string): PortfolioRow[] {
  return data.projects
    .filter(p => p.spaceId === spaceId && (!projectId || p.id === projectId))
    .map(p => {
      const issues = data.issues.filter(i => i.projectId === p.id && !i.triage && isLive(i))
      const latest = [...p.updates].sort((a, b) => (a.at < b.at ? 1 : -1))[0]
      return { id: p.id, name: p.name, status: p.status, lead: p.lead, pct: progress(issues, p.statuses).pct, targetDate: p.targetDate, health: latest?.health }
    })
}
