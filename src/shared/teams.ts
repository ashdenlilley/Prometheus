import type { ActivityEntry, AppData, Issue, Project, Team } from './types'

// Team-owned fields. Projects mirror these, so patching a team writes them to every project in it.
export const MIRRORED_FIELDS = ['statuses', 'cycleLength', 'autoCycles', 'autoRollOver'] as const

export function teamFromProject(p: Project, issues: Issue[]): Team {
  const top = issues.reduce((m, i) => (i.projectId === p.id ? Math.max(m, i.number) : m), 0)
  return {
    id: `team-${p.id}`,
    spaceId: p.spaceId,
    name: p.name,
    key: p.key,
    color: p.color,
    members: [...p.members],
    statuses: p.statuses.map(s => ({ ...s })),
    nextNumber: top + 1,
    cycleLength: p.cycleLength,
    autoCycles: p.autoCycles,
    autoRollOver: p.autoRollOver
  }
}

// Brings older data up to one team per project. Returns the same object when nothing changed.
export function ensureTeams(data: AppData): AppData {
  let teams = data.teams
  let changed = false
  const projects = data.projects.map(p => {
    if (p.teamId && teams.some(t => t.id === p.teamId)) return p
    changed = true
    const id = `team-${p.id}`
    if (!teams.some(t => t.id === id)) teams = [...teams, teamFromProject(p, data.issues)]
    return { ...p, teamId: id }
  })
  const byId = new Map(projects.map(p => [p.id, p] as const))
  const issues = data.issues.map(i => {
    const p = byId.get(i.projectId)
    if (i.key !== undefined || !p) return i
    changed = true
    return { ...i, key: p.key }
  })
  const cycles = data.cycles.map(c => {
    const p = byId.get(c.projectId)
    if (c.teamId || !p) return c
    changed = true
    return { ...c, teamId: p.teamId }
  })
  if (!changed) return data
  return { ...data, projects, teams, issues, cycles }
}

export function teamOf(data: AppData, projectId: string): Team | undefined {
  const teamId = data.projects.find(p => p.id === projectId)?.teamId
  return data.teams.find(t => t.id === teamId)
}

// Next free number for a team's key in its space. Numbers already in use can exceed nextNumber after a sync.
export function nextIssueNumber(data: AppData, teamId: string): number {
  const team = data.teams.find(t => t.id === teamId)
  if (!team) return 1
  const inSpace = new Set(data.projects.filter(p => p.spaceId === team.spaceId).map(p => p.id))
  const top = data.issues.reduce((m, i) => (i.key === team.key && inSpace.has(i.projectId) ? Math.max(m, i.number) : m), 0)
  return Math.max(team.nextNumber, top + 1)
}

// Team keys are unique across the workspace, so two teams never share a prefix.
export function validTeamKey(data: AppData, key: string, exceptTeamId?: string): boolean {
  return /^[A-Z][A-Z0-9]{0,9}$/.test(key) && !data.teams.some(t => t.key === key && t.id !== exceptTeamId)
}

export function moveProjectToTeam(data: AppData, projectId: string, teamId: string): AppData {
  const team = data.teams.find(t => t.id === teamId)
  const project = data.projects.find(p => p.id === projectId)
  if (!team || !project) return data
  const fallback = team.statuses[0]?.id
  return {
    ...data,
    projects: data.projects.map(p => (p.id === projectId ? { ...p, teamId, statuses: team.statuses, cycleLength: team.cycleLength, autoCycles: team.autoCycles, autoRollOver: team.autoRollOver } : p)),
    cycles: data.cycles.map(c => (c.projectId === projectId ? { ...c, teamId } : c)),
    // Issues keep their key and number; only a status that the new team lacks is remapped
    issues: data.issues.map(i => {
      if (i.projectId !== projectId || team.statuses.some(s => s.id === i.status)) return i
      const category = project.statuses.find(s => s.id === i.status)?.category
      const target = team.statuses.find(s => s.category === category)?.id ?? fallback
      return target ? { ...i, status: target } : i
    })
  }
}

export function patchTeam(data: AppData, teamId: string, patch: Partial<Team>): AppData {
  const teams = data.teams.map(t => (t.id === teamId ? { ...t, ...patch } : t))
  const shared = MIRRORED_FIELDS.filter(k => k in patch)
  if (shared.length === 0) return { ...data, teams }
  const team = teams.find(t => t.id === teamId)!
  const mirror = Object.fromEntries(shared.map(k => [k, team[k]]))
  return { ...data, teams, projects: data.projects.map(p => (p.teamId === teamId ? { ...p, ...mirror } : p)) }
}

export function canArchiveTeam(data: AppData, teamId: string): boolean {
  return !data.projects.some(p => p.teamId === teamId)
}

// Only issues this new are ever renumbered, so old issues (including kept keys from merged projects) never change.
export const CLASH_WINDOW_MS = 24 * 60 * 60 * 1000

// After a sync, two issues in one team can share a key and number. The earlier one keeps it; the later one,
// if it was created in the last day, gets the next free number.
export function resolveNumberClashes(data: AppData, now = Date.now()): AppData {
  const byCreation = [...data.issues].sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1))
  const seen = new Set<string>()
  const clashes: Issue[] = []
  for (const i of byCreation) {
    const p = data.projects.find(x => x.id === i.projectId)
    if (!p) continue
    const k = `${p.teamId}|${i.key ?? p.key}|${i.number}`
    if (seen.has(k)) {
      if (now - Date.parse(i.createdAt) <= CLASH_WINDOW_MS) clashes.push(i)
    }
    else seen.add(k)
  }
  let out = data
  for (const old of clashes) {
    const team = teamOf(out, old.projectId)
    if (!team) continue
    const number = nextIssueNumber(out, team.id)
    const was = `${old.key ?? team.key}-${old.number}`
    const entry: ActivityEntry = { id: crypto.randomUUID(), at: new Date().toISOString(), text: `Renumbered from ${was} to ${team.key}-${number} after a sync clash` }
    out = {
      ...out,
      teams: out.teams.map(t => (t.id === team.id ? { ...t, nextNumber: number + 1 } : t)),
      issues: out.issues.map(i => (i.id === old.id ? { ...i, number, key: team.key, activity: [...i.activity, entry] } : i))
    }
  }
  return clashes.length ? out : data
}
