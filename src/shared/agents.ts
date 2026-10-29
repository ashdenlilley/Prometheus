import type { Agent, AppData, Issue } from './types'

// Agents as assignees. Pure helpers: no node imports, so the renderer can use them too.

export const AGENT_PREFIX = 'agent:'

// The shared MCP token predates agents. Calls made with it are attributed to this agent.
export const LEGACY_AGENT: Pick<Agent, 'id' | 'name' | 'level'> = { id: 'legacy', name: 'Unnamed agent', level: 'write' }

export const isAgentAssignee = (s: string) => s.startsWith(AGENT_PREFIX)

export const agentIdOf = (s: string): string | undefined => (isAgentAssignee(s) ? s.slice(AGENT_PREFIX.length) : undefined)

export const agentAssignee = (id: string) => `${AGENT_PREFIX}${id}`

export function displayAssignee(data: AppData, assignee: string): string {
  const id = agentIdOf(assignee)
  if (id === undefined) return assignee
  if (id === LEGACY_AGENT.id) return LEGACY_AGENT.name
  return data.agents?.find(a => a.id === id)?.name ?? 'Unknown agent'
}

export const activeAgents = (data: AppData): Agent[] => (data.agents ?? []).filter(a => !a.revokedAt)

// Marks activity entries that are new in `next` (by id, per issue) with the actor that made the change.
// Entries that already carry an actor keep it.
export function stampActor(prev: AppData, next: AppData, actor: string): AppData {
  const before = new Map(prev.issues.map(i => [i.id, new Set((i.activity ?? []).map(a => a.id))]))
  let changed = false
  const issues = next.issues.map((issue): Issue => {
    const seen = before.get(issue.id) ?? new Set<string>()
    if (!issue.activity.some(a => !seen.has(a.id) && !a.actor)) return issue
    changed = true
    return { ...issue, activity: issue.activity.map(a => (seen.has(a.id) || a.actor ? a : { ...a, actor })) }
  })
  return changed ? { ...next, issues } : next
}

// Sliding-window limit per agent. `firstTrip` is true only for the first refused hit of a run of refusals.
export class WriteLimiter {
  private hits = new Map<string, { times: number[]; refused: boolean }>()

  constructor(
    private limit = 60,
    private windowMs = 60_000,
    private now = Date.now
  ) {}

  hit(agentId: string): { ok: boolean; firstTrip: boolean } {
    const t = this.now()
    const entry = this.hits.get(agentId) ?? { times: [], refused: false }
    entry.times = entry.times.filter(x => t - x < this.windowMs)
    this.hits.set(agentId, entry)
    if (entry.times.length >= this.limit) {
      const firstTrip = !entry.refused
      entry.refused = true
      return { ok: false, firstTrip }
    }
    entry.times.push(t)
    entry.refused = false
    return { ok: true, firstTrip: false }
  }
}

// Activity text stores raw assignee strings; show agent names instead of "agent:<id>".
export function agentText(data: AppData, text: string): string {
  return text.replace(/agent:[A-Za-z0-9-]+/g, m => displayAssignee(data, m))
}
