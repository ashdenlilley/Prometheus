import type { Issue, StatusDef } from './types'
import { addDays, dayDiff, parseISO } from './dates'

// Monday of the week containing `day`.
const mondayOf = (day: string) => addDays(day, -((parseISO(day).getDay() + 6) % 7))

// Monday ISO dates for `weeks` weeks, starting with the week that contains `from`.
export function weekStarts(from: string, weeks: number): string[] {
  const first = mondayOf(from)
  return Array.from({ length: weeks }, (_, n) => addDays(first, n * 7))
}

// Points or issue count per assignee per week. An issue spans its start..due range: points are split evenly across the weeks it spans, a count lands in each.
// Issues without a due date, unassigned, completed, canceled or archived are left out.
export function workloadBuckets(
  issues: Issue[],
  opts: { from: string; weeks: number; measure: 'points' | 'count'; statuses: StatusDef[] }
): { person: string; weeks: number[] }[] {
  const starts = weekStarts(opts.from, opts.weeks)
  const rows = new Map<string, number[]>()
  for (const issue of issues) {
    const category = opts.statuses.find(s => s.id === issue.status)?.category ?? 'unstarted'
    if (!issue.dueDate || !issue.assignee || issue.assignee === 'Unassigned' || issue.archivedAt) continue
    if (category === 'completed' || category === 'canceled') continue
    const due = issue.dueDate
    const start = issue.startDate && issue.startDate <= due ? issue.startDate : due
    // Weeks spanned in total, including those outside the window, so a split conserves the points.
    const spanned = dayDiff(mondayOf(start), mondayOf(due)) / 7 + 1
    const share = opts.measure === 'points' ? (issue.estimate ?? 1) / spanned : 1
    const row = rows.get(issue.assignee) ?? new Array(opts.weeks).fill(0)
    starts.forEach((w, n) => {
      if (w <= due && addDays(w, 6) >= start) row[n] += share
    })
    rows.set(issue.assignee, row)
  }
  return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([person, weeks]) => ({ person, weeks }))
}
