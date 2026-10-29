import type { AppData, Cycle, Issue, StatusDef } from './types'

const categoryOf = (statuses: StatusDef[], issue: Issue) => statuses.find(s => s.id === issue.status)?.category ?? 'unstarted'

// Sum of estimates for a cycle's issues. Canceled issues are left out.
export function cyclePoints(issues: Issue[], cycleId: string, statuses: StatusDef[]): number {
  return issues
    .filter(i => i.cycleId === cycleId && categoryOf(statuses, i) !== 'canceled')
    .reduce((sum, i) => sum + (i.estimate ?? 0), 0)
}

// Mean completed points over the last `n` cycles that ended before `today`. 0 when there are none.
export function averageVelocity(data: AppData, projectId: string, today: string, n = 3): number {
  const statuses = data.projects.find(p => p.id === projectId)?.statuses ?? []
  const ended = data.cycles
    .filter(c => c.projectId === projectId && c.endDate < today)
    .sort((a: Cycle, b: Cycle) => b.endDate.localeCompare(a.endDate))
    .slice(0, n)
  if (!ended.length) return 0
  const done = (c: Cycle) =>
    data.issues
      .filter(i => i.cycleId === c.id && categoryOf(statuses, i) === 'completed')
      .reduce((sum, i) => sum + (i.estimate ?? 0), 0)
  return ended.reduce((sum, c) => sum + done(c), 0) / ended.length
}

// Planned load against a budget. No capacity (or zero) means never over.
export function capacityStatus(planned: number, capacity?: number): { ratio: number; over: boolean } {
  if (!capacity) return { ratio: 0, over: false }
  return { ratio: planned / capacity, over: planned > capacity }
}
