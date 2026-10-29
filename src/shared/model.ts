import { addDays, dayDiff, toISO } from './dates'
import { applyFilter } from './filter'
import { nextOccurrence, recurrenceCopyId } from './recurrence'
import type {
  ActivityEntry,
  AppData,
  Automation,
  AutomationAction,
  CellValue,
  Column,
  Comment,
  Cycle,
  Dashboard,
  Folder,
  GitLink,
  GitPull,
  Initiative,
  Issue,
  Notification,
  Project,
  Relation,
  RepoRef,
  Space,
  StatusCategory,
  Team,
  Template,
  TriageRule
} from './types'
import { matchIssues, summaryState } from './git'
import { enforceLabelGroups } from './labels'
import { canArchiveTeam, ensureTeams, moveProjectToTeam, nextIssueNumber, patchTeam, teamOf } from './teams'

// Pure data layer shared by the renderer (UI actions) and the main process (MCP tools, DB).

export type Action =
  | { type: 'load'; data: AppData }
  | { type: 'addSpace'; space: Space }
  | { type: 'patchSpace'; id: string; patch: Partial<Space> }
  | { type: 'deleteSpace'; id: string }
  | { type: 'addFolder'; spaceId: string; folder: Folder }
  | { type: 'renameFolder'; spaceId: string; folderId: string; name: string }
  | { type: 'toggleFolder'; spaceId: string; folderId: string }
  | { type: 'deleteFolder'; spaceId: string; folderId: string }
  | { type: 'moveProjectToFolder'; projectId: string; folderId: string | null }
  | { type: 'addInitiative'; initiative: Initiative }
  | { type: 'patchInitiative'; id: string; patch: Partial<Initiative> }
  | { type: 'deleteInitiative'; id: string }
  | { type: 'addTeam'; team: Team }
  | { type: 'patchTeam'; id: string; patch: Partial<Team> }
  | { type: 'archiveTeam'; id: string }
  | { type: 'moveProjectToTeam'; projectId: string; teamId: string }
  | { type: 'addProject'; project: Project }
  | { type: 'patchProject'; id: string; patch: Partial<Project> }
  | { type: 'deleteProject'; id: string }
  | { type: 'addColumn'; projectId: string; column: Column }
  | { type: 'patchColumn'; projectId: string; columnId: string; patch: Partial<Column> }
  | { type: 'deleteColumn'; projectId: string; columnId: string }
  | { type: 'addIssue'; issue: Issue }
  | { type: 'addIssues'; issues: Issue[] }
  | { type: 'patchIssue'; id: string; patch: Partial<Issue> }
  | { type: 'patchIssues'; ids: string[]; patch: Partial<Issue> }
  | { type: 'deleteIssue'; id: string }
  | { type: 'deleteIssues'; ids: string[] }
  | { type: 'addComment'; issueId: string; comment: Comment }
  | { type: 'deleteComment'; issueId: string; commentId: string }
  | { type: 'toggleReaction'; issueId: string; commentId: string; emoji: string; by: string }
  | { type: 'pressButton'; issueId: string; columnId: string }
  | { type: 'addRelation'; issueId: string; relation: Relation }
  | { type: 'removeRelation'; issueId: string; index: number }
  | { type: 'addCycle'; cycle: Cycle }
  | { type: 'patchCycle'; id: string; patch: Partial<Cycle> }
  | { type: 'deleteCycle'; id: string }
  | { type: 'rollOverCycle'; cycleId: string; toCycleId: string }
  | { type: 'autoRollOver'; today: string }
  | { type: 'markRolledOver'; today: string }
  | { type: 'addProjectFromTemplate'; project: Project; automations: Automation[]; triageRules: TriageRule[]; issues: Issue[] }
  | { type: 'addAutomation'; automation: Automation }
  | { type: 'patchAutomation'; id: string; patch: Partial<Automation> }
  | { type: 'deleteAutomation'; id: string }
  | { type: 'addTriageRule'; rule: TriageRule }
  | { type: 'patchTriageRule'; id: string; patch: Partial<TriageRule> }
  | { type: 'deleteTriageRule'; id: string }
  | { type: 'addTemplate'; template: Template }
  | { type: 'deleteTemplate'; id: string }
  | { type: 'addDashboard'; dashboard: Dashboard }
  | { type: 'patchDashboard'; id: string; patch: Partial<Dashboard> }
  | { type: 'deleteDashboard'; id: string }
  | { type: 'setProjectRepos'; projectId: string; repos: RepoRef[] }
  | { type: 'setGitAutomation'; projectId: string; automation: Project['gitAutomation'] }
  | { type: 'syncGitPulls'; projectId: string; repo: string; pulls: GitPull[]; at: string }
  | { type: 'removeGitLink'; id: string }
  | { type: 'notify'; notification: Notification }
  | { type: 'markNotifications'; read: boolean }
  | { type: 'tick'; today: string }

const mapProject = (s: AppData, id: string, fn: (p: Project) => Project): AppData => ({
  ...s,
  projects: s.projects.map(p => (p.id === id ? fn(p) : p))
})

const mapFolders = (s: AppData, spaceId: string, fn: (fs: Folder[]) => Folder[]): AppData => ({
  ...s,
  spaces: s.spaces.map(sp => (sp.id === spaceId ? { ...sp, folders: fn(sp.folders ?? []) } : sp))
})

export const today = () => new Date().toISOString().slice(0, 10)

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Category for a project's status id. Unknown ids count as 'unstarted'.
export function categoryOf(project: Project | undefined, statusId: string): StatusCategory {
  return project?.statuses.find(s => s.id === statusId)?.category ?? 'unstarted'
}

export function statusLabel(project: Project | undefined, statusId: string): string {
  return project?.statuses.find(s => s.id === statusId)?.label ?? statusId
}

// Keeps each team's sequence ahead of the keyed issues added to it (sync, import, MCP).
function bumpTeams(s: AppData, added: Issue[]): AppData {
  const next = new Map<string, number>()
  for (const i of added) {
    const team = teamOf(s, i.projectId)
    if (team && i.key === team.key) next.set(team.id, Math.max(next.get(team.id) ?? 0, i.number + 1))
  }
  return { ...s, teams: s.teams.map(t => (next.has(t.id) ? { ...t, nextNumber: Math.max(t.nextNumber, next.get(t.id)!) } : t)) }
}

export function reducer(s: AppData, a: Action): AppData {
  switch (a.type) {
    case 'load':
      return ensureTeams(a.data)
    case 'addTeam':
      return { ...s, teams: [...s.teams, a.team] }
    case 'patchTeam':
      return patchTeam(s, a.id, a.patch)
    case 'archiveTeam':
      if (!canArchiveTeam(s, a.id)) return s
      return { ...s, teams: s.teams.map(t => (t.id === a.id ? { ...t, archivedAt: new Date().toISOString() } : t)) }
    case 'moveProjectToTeam':
      return moveProjectToTeam(s, a.projectId, a.teamId)
    case 'addSpace':
      return { ...s, spaces: [...s.spaces, a.space] }
    case 'patchSpace':
      return { ...s, spaces: s.spaces.map(sp => (sp.id === a.id ? { ...sp, ...a.patch } : sp)) }
    case 'deleteSpace': {
      const projectIds = s.projects.filter(p => p.spaceId === a.id).map(p => p.id)
      return {
        ...s,
        spaces: s.spaces.filter(sp => sp.id !== a.id),
        initiatives: s.initiatives.filter(i => i.spaceId !== a.id),
        dashboards: s.dashboards.filter(d => d.spaceId !== a.id),
        teams: s.teams.filter(t => t.spaceId !== a.id),
        projects: s.projects.filter(p => p.spaceId !== a.id),
        issues: s.issues.filter(i => !projectIds.includes(i.projectId)),
        cycles: s.cycles.filter(c => !projectIds.includes(c.projectId)),
        automations: s.automations.filter(x => !projectIds.includes(x.projectId)),
        triageRules: s.triageRules.filter(r => !projectIds.includes(r.projectId)),
        templates: s.templates.filter(t => !projectIds.includes(t.projectId))
      }
    }
    case 'addFolder':
      return mapFolders(s, a.spaceId, fs => [...fs, a.folder])
    case 'renameFolder':
      return mapFolders(s, a.spaceId, fs => fs.map(f => (f.id === a.folderId ? { ...f, name: a.name } : f)))
    case 'toggleFolder':
      return mapFolders(s, a.spaceId, fs => fs.map(f => (f.id === a.folderId ? { ...f, collapsed: !f.collapsed } : f)))
    case 'deleteFolder': {
      const out = mapFolders(s, a.spaceId, fs => fs.filter(f => f.id !== a.folderId))
      return { ...out, projects: out.projects.map(p => (p.spaceId === a.spaceId && p.folderId === a.folderId ? { ...p, folderId: undefined } : p)) }
    }
    case 'moveProjectToFolder': {
      const project = s.projects.find(p => p.id === a.projectId)
      if (!project) return s
      if (a.folderId !== null && !s.spaces.find(sp => sp.id === project.spaceId)?.folders?.some(f => f.id === a.folderId)) return s
      return mapProject(s, a.projectId, p => ({ ...p, folderId: a.folderId ?? undefined }))
    }
    case 'addInitiative':
      return { ...s, initiatives: [...s.initiatives, a.initiative] }
    case 'patchInitiative': {
      const out = { ...s, initiatives: s.initiatives.map(i => (i.id === a.id ? { ...i, ...a.patch } : i)) }
      const before = s.initiatives.find(i => i.id === a.id)
      if (!before || a.patch.status === undefined || a.patch.status === before.status) return out
      const projectIds = s.projects.filter(p => p.initiativeId === a.id).map(p => p.id)
      const rules = s.automations.filter(r => r.enabled && projectIds.includes(r.projectId) && r.trigger.type === 'initiative_status_changed' && (r.trigger.to === undefined || r.trigger.to === a.patch.status))
      return runProjectRules(out, rules)
    }
    case 'deleteInitiative':
      return {
        ...s,
        initiatives: s.initiatives.filter(i => i.id !== a.id),
        projects: s.projects.map(p => (p.initiativeId === a.id ? { ...p, initiativeId: undefined } : p))
      }
    case 'addProject':
      return ensureTeams({ ...s, projects: [...s.projects, a.project] })
    case 'patchProject': {
      // Statuses and cycle settings belong to the team, so they are written to every project in it
      const { statuses, cycleLength, autoCycles, autoRollOver, ...own } = a.patch
      const shared = Object.fromEntries(Object.entries({ statuses, cycleLength, autoCycles, autoRollOver }).filter(([k]) => k in a.patch)) as Partial<Team>
      const team = teamOf(s, a.id)
      const base = team && Object.keys(shared).length ? patchTeam(s, team.id, shared) : s
      const out = mapProject(base, a.id, p => ({ ...p, ...(team ? own : a.patch) }))
      const before = s.projects.find(p => p.id === a.id)
      if (!before || a.patch.status === undefined || a.patch.status === before.status) return out
      const rules = s.automations.filter(r => r.enabled && r.projectId === a.id && r.trigger.type === 'project_status_changed' && (r.trigger.to === undefined || r.trigger.to === a.patch.status))
      return runProjectRules(out, rules)
    }
    case 'deleteProject':
      return {
        ...s,
        projects: s.projects.filter(p => p.id !== a.id),
        issues: s.issues.filter(i => i.projectId !== a.id),
        cycles: s.cycles.filter(c => c.projectId !== a.id),
        // Rules elsewhere that create issues in this project can no longer run
        automations: s.automations
          .filter(x => x.projectId !== a.id)
          .map(x => (x.action.type === 'create_issue' && x.action.projectId === a.id ? { ...x, enabled: false } : x)),
        triageRules: s.triageRules.filter(r => r.projectId !== a.id),
        templates: s.templates.filter(t => t.projectId !== a.id)
      }
    case 'addColumn':
      return mapProject(s, a.projectId, p => ({ ...p, columns: [...p.columns, a.column] }))
    case 'patchColumn':
      return mapProject(s, a.projectId, p => ({
        ...p,
        columns: p.columns.map(c => (c.id === a.columnId ? { ...c, ...a.patch } : c))
      }))
    case 'deleteColumn':
      return {
        ...mapProject(s, a.projectId, p => ({ ...p, columns: p.columns.filter(c => c.id !== a.columnId) })),
        issues: s.issues.map(i => {
          if (i.projectId !== a.projectId) return i
          return { ...i, values: withValue(i.values, a.columnId, undefined) }
        })
      }
    case 'addIssue': {
      const project = s.projects.find(p => p.id === a.issue.projectId)
      const issue = a.issue.subscribed === undefined && project?.autoSubscribe !== false ? { ...a.issue, subscribed: true } : a.issue
      const added = intake(s, issue)
      return bumpTeams({ ...s, issues: [...s.issues, added] }, [added])
    }
    case 'addIssues': {
      const issues = a.issues.map(i => {
        const project = s.projects.find(p => p.id === i.projectId)
        return i.subscribed === undefined && project?.autoSubscribe !== false ? { ...i, subscribed: true } : i
      })
      const added = issues.map(i => intake(s, i))
      return bumpTeams({ ...s, issues: [...s.issues, ...added] }, added)
    }
    case 'patchIssue':
      return updateIssue(s, a.id, a.patch)
    case 'patchIssues':
      return a.ids.reduce((acc, id) => updateIssue(acc, id, a.patch), s)
    case 'deleteIssue':
      return deleteIssues(s, [a.id])
    case 'deleteIssues':
      return deleteIssues(s, a.ids)
    case 'addComment': {
      const issue = s.issues.find(i => i.id === a.issueId)
      const withComment = mapIssue(s, a.issueId, i => ({ ...i, comments: [...i.comments, a.comment], updatedAt: new Date().toISOString() }))
      // A mention of the local user (@name, case-insensitive) raises a notification.
      const mentioned = s.me && new RegExp(`@${escapeRegExp(s.me)}\\b`, 'i').test(a.comment.body)
      if (!mentioned || !issue) return withComment
      return {
        ...withComment,
        notifications: [
          { id: crypto.randomUUID(), at: a.comment.at, text: `${a.comment.author} mentioned you`, issueId: issue.id, read: false },
          ...withComment.notifications
        ].slice(0, 200)
      }
    }
    case 'deleteComment':
      return mapIssue(s, a.issueId, i => ({ ...i, comments: i.comments.filter(c => c.id !== a.commentId) }))
    case 'toggleReaction':
      // Like mapIssue, this leaves updatedAt alone: a reaction is not an issue edit.
      return mapIssue(s, a.issueId, i => ({
        ...i,
        comments: i.comments.map(c => {
          if (c.id !== a.commentId) return c
          const same = (r: { emoji: string; by: string }) => r.emoji === a.emoji && r.by === a.by
          const current = c.reactions ?? []
          const reactions = current.some(same) ? current.filter(r => !same(r)) : [...current, { emoji: a.emoji, by: a.by }]
          return { ...c, reactions }
        })
      }))
    case 'pressButton': {
      // One step: count the click, then run the column's action (if any) as its own automation.
      const issue = s.issues.find(i => i.id === a.issueId)
      const column = s.projects.find(p => p.id === issue?.projectId)?.columns.find(c => c.id === a.columnId)
      if (!issue || !column) return s
      const count = typeof issue.values[a.columnId] === 'number' ? (issue.values[a.columnId] as number) : 0
      const next = updateIssue(s, a.issueId, { values: { ...issue.values, [a.columnId]: count + 1 } })
      if (!column.buttonAction) return next
      const rule: Automation = { id: 'button:' + column.id, projectId: issue.projectId, name: column.buttonLabel || column.name, enabled: true, trigger: { type: 'column_changed', columnId: column.id }, action: column.buttonAction }
      return applyAction(next, a.issueId, rule)
    }
    case 'addRelation':
      return mapIssue(s, a.issueId, i => ({ ...i, relations: [...i.relations, a.relation] }))
    case 'removeRelation':
      return mapIssue(s, a.issueId, i => ({ ...i, relations: i.relations.filter((_, n) => n !== a.index) }))
    case 'addCycle':
      return { ...s, cycles: [...s.cycles, a.cycle] }
    case 'patchCycle':
      return { ...s, cycles: s.cycles.map(c => (c.id === a.id ? { ...c, ...a.patch } : c)) }
    case 'deleteCycle':
      return {
        ...s,
        cycles: s.cycles.filter(c => c.id !== a.id),
        issues: s.issues.map(i => (i.cycleId === a.id ? { ...i, cycleId: undefined } : i))
      }
    case 'rollOverCycle': {
      // Move unfinished issues from one cycle to another. Completed and canceled stay put.
      const owner = s.projects.find(p => p.id === s.cycles.find(c => c.id === a.cycleId)?.projectId)
      return {
        ...s,
        issues: s.issues.map(i => {
          if (i.cycleId !== a.cycleId) return i
          if (categoryOf(owner, i.status) === 'completed' || categoryOf(owner, i.status) === 'canceled') return i
          return { ...i, cycleId: a.toCycleId, activity: [...i.activity, { id: crypto.randomUUID(), at: new Date().toISOString(), text: 'Rolled over to next cycle' }] }
        })
      }
    }
    case 'autoRollOver':
      return autoRollOverCycles(s, a.today)
    case 'markRolledOver':
      return markRolledOver(s, a.today)
    case 'addProjectFromTemplate':
      return ensureTeams({
        ...s,
        projects: [...s.projects, a.project],
        automations: [...s.automations, ...a.automations],
        triageRules: [...s.triageRules, ...a.triageRules],
        issues: [...s.issues, ...a.issues]
      })
    case 'addAutomation':
      return { ...s, automations: [...s.automations, a.automation] }
    case 'patchAutomation':
      return { ...s, automations: s.automations.map(x => (x.id === a.id ? { ...x, ...a.patch } : x)) }
    case 'deleteAutomation':
      return { ...s, automations: s.automations.filter(x => x.id !== a.id) }
    case 'addTriageRule':
      return { ...s, triageRules: [...s.triageRules, a.rule] }
    case 'patchTriageRule':
      return { ...s, triageRules: s.triageRules.map(r => (r.id === a.id ? { ...r, ...a.patch } : r)) }
    case 'deleteTriageRule':
      return { ...s, triageRules: s.triageRules.filter(r => r.id !== a.id) }
    case 'tick':
      return runHousekeeping(runRecurrences(runTimedRules(s, a.today), a.today), a.today)
    case 'addTemplate':
      return { ...s, templates: [...s.templates, a.template] }
    case 'deleteTemplate':
      return { ...s, templates: s.templates.filter(t => t.id !== a.id) }
    case 'addDashboard':
      return { ...s, dashboards: [...s.dashboards, a.dashboard] }
    case 'patchDashboard':
      return { ...s, dashboards: s.dashboards.map(d => (d.id === a.id ? { ...d, ...a.patch } : d)) }
    case 'deleteDashboard':
      return { ...s, dashboards: s.dashboards.filter(d => d.id !== a.id) }
    case 'setProjectRepos':
      return mapProject(s, a.projectId, p => ({ ...p, repos: a.repos }))
    case 'setGitAutomation':
      return mapProject(s, a.projectId, p => ({ ...p, gitAutomation: a.automation }))
    case 'syncGitPulls':
      return syncGitPulls(s, a)
    case 'removeGitLink': {
      const link = s.gitLinks?.find(l => l.id === a.id)
      if (!link) return s
      const gitLinks = s.gitLinks!.filter(l => l.id !== a.id)
      return { ...s, gitLinks, issues: s.issues.map(i => (i.id === link.issueId ? withPrState(i, gitLinks) : i)) }
    }
    case 'notify':
      return { ...s, notifications: [a.notification, ...s.notifications].slice(0, 200) }
    case 'markNotifications':
      return { ...s, notifications: s.notifications.map(n => ({ ...n, read: a.read })) }
  }
}

// New items in triage pick up the project's triage rules before they are stored.
function intake(s: AppData, issue: Issue): Issue {
  if (!issue.triage) return issue
  const project = s.projects.find(p => p.id === issue.projectId)
  return s.triageRules
    .filter(r => r.enabled && r.projectId === issue.projectId)
    .reduce((acc, rule) => {
      if (applyFilter([acc], rule.when, project).length === 0) return acc
      return { ...acc, ...rule.set }
    }, issue)
}

// Auto roll-over for projects with autoRollOver on. Ended, unmarked cycles move unfinished issues to the next cycle,
// creating it first when autoCycles is on. Marking a cycle as done is a separate, non-undoable step (markRolledOver),
// so undoing a roll-over puts the issues back without them being rolled over again on the next tick.
export function autoRollOverCycles(s: AppData, today: string): AppData {
  let out = s
  for (const p of s.projects) {
    if (!p.autoRollOver) continue
    // Cycles created below are appended here, so the loop also reaches an ended new cycle.
    const list = s.cycles.filter(c => c.projectId === p.id).sort((a, b) => a.startDate.localeCompare(b.startDate))
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (c.endDate >= today || out.cycles.find(x => x.id === c.id)?.rolledOver) continue
      let next = list.find(n => n.startDate > c.endDate)
      if (!next && p.autoCycles) {
        const startDate = addDays(c.endDate, 1)
        const count = out.cycles.filter(x => x.projectId === p.id).length
        next = { id: crypto.randomUUID(), projectId: p.id, name: `Cycle ${count + 1}`, startDate, endDate: addDays(startDate, p.cycleLength - 1) }
        list.push(next)
        out = { ...out, cycles: [...out.cycles, next] }
      }
      if (!next) continue
      const before = out
      out = reducer(out, { type: 'rollOverCycle', cycleId: c.id, toCycleId: next.id })
      // rollOverCycle always copies the issue list; keep the old reference when nothing moved.
      if (out.issues.every((i, n) => i === before.issues[n] || i.cycleId === before.issues[n].cycleId)) out = before
    }
  }
  return out
}

// Marks ended cycles of autoRollOver projects that have a following cycle, so they are rolled over only once.
export function markRolledOver(s: AppData, today: string): AppData {
  const marked = s.cycles.map(c => {
    if (c.rolledOver || c.endDate >= today) return c
    if (!s.projects.find(p => p.id === c.projectId)?.autoRollOver) return c
    const hasNext = s.cycles.some(n => n.projectId === c.projectId && n.startDate > c.endDate)
    return hasNext ? { ...c, rolledOver: true } : c
  })
  return marked.every((c, n) => c === s.cycles[n]) ? s : { ...s, cycles: marked }
}

// Timed automations (due date passed). Each rule fires once per issue per due date.
export function runTimedRules(s: AppData, today: string): AppData {
  const rules = s.automations.filter(r => r.enabled && r.trigger.type === 'due_passed')
  let out = runCycleRules(s, today)
  for (const rule of rules) {
    const project = out.projects.find(p => p.id === rule.projectId)
    const candidates = out.issues.filter(i => i.projectId === rule.projectId && i.dueDate && i.dueDate < today)
    for (const issue of candidates) {
      const cat = categoryOf(project, issue.status)
      if (cat === 'completed' || cat === 'canceled') continue
      const key = `${rule.id}:${issue.dueDate}`
      if (issue.firedAutomations?.includes(key)) continue
      out = mapIssue(out, issue.id, i => ({ ...i, firedAutomations: [...(i.firedAutomations ?? []), key] }))
      out = applyAction(out, issue.id, rule)
    }
  }
  return out
}

// Recurring issues copy themselves once per due date. After a long gap only one copy is made, then the rule moves past today.
export function runRecurrences(s: AppData, today: string): AppData {
  let out = s
  for (const src of s.issues) {
    const r = src.recurrence
    if (!r || r.next > today) continue
    const now = new Date().toISOString()
    const copy = createIssue(out, src.projectId, src.title, {
      id: recurrenceCopyId(src.id, r.next),
      description: src.description,
      labels: [...src.labels],
      priority: src.priority,
      assignee: src.assignee,
      estimate: src.estimate,
      dueDate: r.dueInDays === undefined ? undefined : addDays(today, r.dueInDays),
      activity: [{ id: crypto.randomUUID(), at: now, text: `Created from ${issueKey(out, src)} (recurring)` }]
    })
    // Another device may already have made this period's copy under the same id; then only the rule advances.
    const exists = out.issues.some(i => i.id === copy.id)
    out = {
      ...out,
      issues: [...out.issues.map(i => (i.id === src.id ? { ...i, recurrence: { ...r, next: nextOccurrence(r, today) } } : i)), ...(exists ? [] : [copy])]
    }
  }
  return out
}

// Auto-close moves stale open issues to a canceled status; auto-archive hides old completed/canceled ones.
// Each rule only picks issues that still match it, so running it again changes nothing.
// Age is measured in local calendar days, the same calendar as `today`.
export function runHousekeeping(s: AppData, today: string): AppData {
  let out = s
  const now = new Date().toISOString()
  for (const p of s.projects) {
    const close = p.autoClose
    if (!close || close.days < 1 || !p.statuses.some(st => st.id === close.status && st.category === 'canceled')) continue
    for (const issue of s.issues) {
      if (issue.projectId !== p.id || issue.triage || issue.archivedAt) continue
      const cat = categoryOf(p, issue.status)
      if (cat === 'completed' || cat === 'canceled' || dayDiff(toISO(new Date(issue.updatedAt)), today) < close.days) continue
      out = updateIssue(out, issue.id, { status: close.status }, false)
      out = mapIssue(out, issue.id, i => ({ ...i, activity: [...i.activity, { id: crypto.randomUUID(), at: now, text: `Auto-closed after ${close.days} days without updates` }] }))
      out = {
        ...out,
        notifications: [
          { id: crypto.randomUUID(), at: now, text: `${issueKey(out, issue)} auto-closed after ${close.days} days without updates`, issueId: issue.id, read: false },
          ...out.notifications
        ].slice(0, 200)
      }
    }
  }
  for (const p of s.projects) {
    const days = p.autoArchive?.days ?? 0
    if (days < 1) continue
    for (const issue of s.issues) {
      if (issue.projectId !== p.id || issue.archivedAt) continue
      const cat = categoryOf(p, issue.status)
      if ((cat !== 'completed' && cat !== 'canceled') || dayDiff(toISO(new Date(issue.updatedAt)), today) < days) continue
      // Archiving does not bump updatedAt. Unarchiving is a plain patchIssue, which does, so an unarchived issue waits N more days before it is archived again.
      out = mapIssue(out, issue.id, i => ({ ...i, archivedAt: now, activity: [...i.activity, { id: crypto.randomUUID(), at: now, text: 'Archived automatically' }] }))
    }
  }
  return out
}

function mapIssue(s: AppData, id: string, fn: (i: Issue) => Issue): AppData {
  return { ...s, issues: s.issues.map(i => (i.id === id ? fn(i) : i)) }
}

// The issue's prState recomputed from its links. Returns the same issue when nothing changed.
function withPrState(i: Issue, gitLinks: GitLink[]): Issue {
  const pr = summaryState(gitLinks.filter(l => l.issueId === i.id).map(l => l.state))
  return pr === i.prState ? i : { ...i, prState: pr }
}

const GIT_FIELDS = ['title', 'url', 'state', 'branch', 'updatedAt'] as const

// Links each pull to its matching issues, logs new links and state changes, and moves issues per the
// project's gitAutomation. Each move is keyed in firedAutomations, so repeated polls do nothing.
function syncGitPulls(s: AppData, a: { projectId: string; repo: string; pulls: GitPull[]; at: string }): AppData {
  const project = s.projects.find(p => p.id === a.projectId)
  if (!project) return s
  let out = s
  let changed = false
  const touched = new Set<string>()
  const log = (issueId: string, text: string) =>
    (out = mapIssue(out, issueId, i => ({ ...i, activity: [...i.activity, { id: crypto.randomUUID(), at: a.at, text }].slice(-200) })))
  for (const pull of a.pulls) {
    const label = `${a.repo}#${pull.number}`
    for (const issue of matchIssues(s, pull, a.projectId)) {
      const id = `${issue.id}:${label}`
      const prev = out.gitLinks?.find(l => l.id === id)
      const link: GitLink = { id, issueId: issue.id, provider: 'github', repo: a.repo, number: pull.number, title: pull.title, url: pull.url, state: pull.state, branch: pull.branch, updatedAt: pull.updatedAt }
      if (!prev || GIT_FIELDS.some(f => prev[f] !== link[f])) {
        const gitLinks = out.gitLinks ?? []
        out = { ...out, gitLinks: prev ? gitLinks.map(l => (l.id === id ? link : l)) : [...gitLinks, link] }
        touched.add(issue.id)
        changed = true
        if (!prev) log(issue.id, `Linked PR ${label}: ${pull.title}`)
        else if (prev.state !== pull.state) log(issue.id, `PR ${label} ${pull.state}`)
      }
      // Automations run even when the link is unchanged, so turning one on applies to PRs already open.
      const target = pull.state === 'open' ? project.gitAutomation?.onOpen : pull.state === 'merged' ? project.gitAutomation?.onMerge : undefined
      const key = `git:${label}:${pull.state}`
      const current = out.issues.find(i => i.id === issue.id)!
      if (!target || current.firedAutomations?.includes(key)) continue
      changed = true
      out = mapIssue(out, issue.id, i => ({ ...i, firedAutomations: [...(i.firedAutomations ?? []), key] }))
      if (current.status !== target) {
        out = updateIssue(out, issue.id, { status: target })
        log(issue.id, `Moved by PR ${pull.url}`)
      }
    }
  }
  if (!changed) return s
  return {
    ...out,
    issues: out.issues.map(i => (touched.has(i.id) ? withPrState(i, out.gitLinks ?? []) : i))
  }
}

function deleteIssues(s: AppData, ids: string[]): AppData {
  // Children lose their parent rather than being deleted with it.
  return {
    ...s,
    issues: s.issues
      .filter(i => !ids.includes(i.id))
      .map(i => (i.parentId && ids.includes(i.parentId) ? { ...i, parentId: undefined } : i))
      .map(i => ({ ...i, relations: i.relations.filter(r => !ids.includes(r.targetId)) }))
  }
}

// Applies a patch, records activity, and runs automations for the project.
function updateIssue(s: AppData, id: string, patch: Partial<Issue>, rules = true): AppData {
  const before = s.issues.find(i => i.id === id)
  if (!before) return s
  const now = new Date().toISOString()
  const project = s.projects.find(p => p.id === before.projectId)
  const space = s.spaces.find(sp => sp.id === project?.spaceId)
  if (patch.labels && space?.labels) patch = { ...patch, labels: enforceLabelGroups(before.labels, patch.labels, space.labels) }
  const next: Issue = { ...before, ...patch, updatedAt: now }

  if (patch.status !== undefined && patch.status !== before.status) {
    const done = categoryOf(project, next.status) === 'completed'
    next.completedAt = done ? now : undefined
  }

  const entries = describeChanges(project, before, next).map<ActivityEntry>(text => ({ id: crypto.randomUUID(), at: now, text }))
  if (entries.length) next.activity = [...before.activity, ...entries].slice(-200)

  const out = { ...s, issues: s.issues.map(i => (i.id === id ? next : i)) }
  return rules ? runAutomations(out, before, next, project) : out
}

function describeChanges(project: Project | undefined, a: Issue, b: Issue): string[] {
  const out: string[] = []
  const fmt = (v: unknown) => (v === undefined || v === '' || v === null ? 'none' : String(v))
  if (a.title !== b.title) out.push(`Title: ${a.title} → ${b.title}`)
  if (a.status !== b.status) out.push(`Status: ${statusLabel(project, a.status)} → ${statusLabel(project, b.status)}`)
  if (a.priority !== b.priority) out.push(`Priority: ${fmt(a.priority)} → ${fmt(b.priority)}`)
  if (a.assignee !== b.assignee) out.push(`Assignee: ${fmt(a.assignee)} → ${fmt(b.assignee)}`)
  if (a.labels.join() !== b.labels.join()) out.push(`Labels: ${fmt(b.labels.join(', '))}`)
  if (a.startDate !== b.startDate) out.push(`Start: ${fmt(a.startDate)} → ${fmt(b.startDate)}`)
  if (a.dueDate !== b.dueDate) out.push(`Due: ${fmt(a.dueDate)} → ${fmt(b.dueDate)}`)
  if (a.estimate !== b.estimate) out.push(`Estimate: ${fmt(a.estimate)} → ${fmt(b.estimate)}`)
  if (a.cycleId !== b.cycleId) out.push('Cycle changed')
  if (a.milestoneId !== b.milestoneId) out.push('Milestone changed')
  if (a.parentId !== b.parentId) out.push('Parent changed')
  if (a.triage && !b.triage) out.push('Accepted from triage')
  if (a.archivedAt !== b.archivedAt) out.push(b.archivedAt ? 'Archived' : 'Unarchived')
  if (a.description !== b.description) out.push('Description edited')
  for (const key of new Set([...Object.keys(a.values), ...Object.keys(b.values)])) {
    if (JSON.stringify(a.values[key]) !== JSON.stringify(b.values[key])) {
      const name = project?.columns.find(c => c.id === key)?.name ?? 'Field'
      out.push(`${name} changed`)
    }
  }
  return out
}

function triggerFires(t: Automation['trigger'], before: Issue, after: Issue): boolean {
  switch (t.type) {
    case 'status_changed':
      return before.status !== after.status && after.status === t.to
    case 'priority_changed':
      return before.priority !== after.priority && after.priority === t.to
    case 'assignee_changed':
      return before.assignee !== after.assignee
    case 'due_passed':
      return !!after.dueDate && after.dueDate < today() && before.dueDate !== after.dueDate
    case 'column_changed': {
      const was = before.values[t.columnId]
      const now = after.values[t.columnId]
      if (JSON.stringify(was) === JSON.stringify(now)) return false
      if (t.to === undefined) return true
      // Multi-value columns (labels-style arrays) match when they contain the value
      return Array.isArray(now) ? now.some(v => String(v) === t.to) : now !== undefined && String(now) === t.to
    }
    // Object triggers (project, cycle, initiative) are run by their own reducer cases, not by issue updates
    case 'project_status_changed':
    case 'cycle_started':
    case 'cycle_ended':
    case 'initiative_status_changed':
      return false
  }
}

function runAutomations(s: AppData, before: Issue, after: Issue, project: Project | undefined): AppData {
  if (!project) return s
  const rules = s.automations.filter(r => r.enabled && r.projectId === project.id && triggerFires(r.trigger, before, after))
  // Actions use updateIssue(..., false), so an automation never fires another automation (depth 1)
  return rules.reduce((acc, rule) => applyAction(acc, after.id, rule), s)
}

function applyAction(s: AppData, issueId: string, rule: Automation): AppData {
  const issue = s.issues.find(i => i.id === issueId)
  if (!issue) return s
  const action = rule.action
  switch (action.type) {
    case 'set_status':
      return updateIssue(s, issueId, { status: action.status }, false)
    case 'set_priority':
      return updateIssue(s, issueId, { priority: action.priority }, false)
    case 'set_assignee':
      return updateIssue(s, issueId, { assignee: action.assignee }, false)
    case 'add_label':
      return updateIssue(s, issueId, { labels: issue.labels.includes(action.label) ? issue.labels : [...issue.labels, action.label] }, false)
    case 'move_to_cycle': {
      const cycle = s.cycles.find(c => c.projectId === issue.projectId && c.startDate <= today() && today() <= c.endDate)
      return cycle ? updateIssue(s, issueId, { cycleId: cycle.id }, false) : s
    }
    case 'create_issue': {
      const project = s.projects.find(p => p.id === issue.projectId)
      if (!action.projectId || action.projectId === issue.projectId) {
        // Follow-up work becomes a sub-issue of the item that triggered it.
        const child = createIssue(s, issue.projectId, action.title, {
          status: action.status ?? project?.statuses[0]?.id ?? 'backlog',
          parentId: issueId
        })
        return { ...s, issues: [...s.issues, child] }
      }
      const target = s.projects.find(p => p.id === action.projectId)
      if (!target || target.spaceId !== project?.spaceId) {
        // Target gone or in another space: stop the rule rather than create work somewhere unexpected
        return disableAutomation(s, rule)
      }
      // A cross-project item is not a sub-issue: it relates back to the trigger issue instead
      const status = target.statuses.some(st => st.id === action.status) ? action.status : target.statuses[0]?.id ?? 'backlog'
      const child = createIssue(s, target.id, action.title, { status, relations: [{ type: 'related', targetId: issueId }] })
      return { ...s, issues: [...s.issues, child] }
    }
    case 'notify':
      return {
        ...s,
        notifications: [
          { id: crypto.randomUUID(), at: new Date().toISOString(), text: `${action.message} (${rule.name})`, issueId, read: false },
          ...s.notifications
        ].slice(0, 200)
      }
  }
}

function disableAutomation(s: AppData, rule: Automation): AppData {
  return {
    ...s,
    automations: s.automations.map(x => (x.id === rule.id ? { ...x, enabled: false } : x)),
    notifications: [
      { id: crypto.randomUUID(), at: new Date().toISOString(), text: `Automation "${rule.name}" was disabled: its target project no longer exists`, read: false },
      ...s.notifications
    ].slice(0, 200)
  }
}

// Object triggers run the same actions on a set of issues, unfinished ones only. Notify adds one notification with no issue.
function applyObjectAction(s: AppData, automation: Automation, issueIds: string[]): AppData {
  const action = automation.action
  if (action.type === 'notify') {
    return {
      ...s,
      notifications: [
        { id: crypto.randomUUID(), at: new Date().toISOString(), text: `${action.message} (${automation.name})`, read: false },
        ...s.notifications
      ].slice(0, 200)
    }
  }
  if (!['set_status', 'set_priority', 'set_assignee', 'add_label'].includes(action.type)) return s
  const project = s.projects.find(p => p.id === automation.projectId)
  return issueIds.reduce((acc, id) => {
    const issue = acc.issues.find(i => i.id === id)
    if (!issue) return acc
    const cat = categoryOf(project, issue.status)
    return cat === 'completed' || cat === 'canceled' ? acc : applyAction(acc, id, automation)
  }, s)
}

// Object-trigger rules act on the issues of their own project
function runProjectRules(s: AppData, rules: Automation[]): AppData {
  return rules.reduce((acc, r) => applyObjectAction(acc, r, acc.issues.filter(i => i.projectId === r.projectId).map(i => i.id)), s)
}

// Cycle start and end rules fire once per cycle. The start (or end) must be on or after the rule's createdAt day
// (missing createdAt means today), so cycles that were already over before the rule existed do not fire.
export function runCycleRules(s: AppData, today: string): AppData {
  let out = s
  for (const rule of s.automations) {
    if (!rule.enabled || (rule.trigger.type !== 'cycle_started' && rule.trigger.type !== 'cycle_ended')) continue
    const started = rule.trigger.type === 'cycle_started'
    const since = rule.createdAt ? toISO(new Date(rule.createdAt)) : today
    for (const cycle of s.cycles.filter(c => c.projectId === rule.projectId)) {
      const edge = started ? cycle.startDate : cycle.endDate
      if (started ? edge > today : edge >= today) continue
      // Only edges on or after the rule's creation day: a cycle already running when the rule was made does not fire "started"
      if (edge < since) continue
      const key = `${rule.id}:${started ? 'started' : 'ended'}`
      if (out.cycles.find(c => c.id === cycle.id)?.firedAutomations?.includes(key)) continue
      out = {
        ...out,
        cycles: out.cycles.map(c => (c.id === cycle.id ? { ...c, firedAutomations: [...(c.firedAutomations ?? []), key] } : c))
      }
      out = applyObjectAction(out, rule, out.issues.filter(i => i.cycleId === cycle.id).map(i => i.id))
    }
  }
  return out
}


export function createIssue(data: AppData, projectId: string, title: string, patch: Partial<Issue> = {}): Issue {
  const now = new Date().toISOString()
  const team = teamOf(data, projectId)
  const project = data.projects.find(p => p.id === projectId)
  const number = team ? nextIssueNumber(data, team.id) : data.issues.filter(i => i.projectId === projectId).reduce((m, i) => Math.max(m, i.number), 0) + 1
  const key = team?.key ?? project?.key
  return {
    id: crypto.randomUUID(),
    projectId,
    number,
    ...(key ? { key } : {}),
    title,
    description: '',
    status: 'backlog',
    priority: 0,
    assignee: '',
    labels: [],
    relations: [],
    comments: [],
    activity: [],
    values: {},
    createdAt: now,
    updatedAt: now,
    ...patch
  }
}

export function issueKey(data: AppData, issue: Issue) {
  const project = data.projects.find(p => p.id === issue.projectId)
  return `${issue.key ?? project?.key ?? 'ISS'}-${issue.number}`
}

export function withValue(values: Issue['values'], id: string, v: CellValue | undefined): Issue['values'] {
  const next = { ...values }
  if (v === undefined) delete next[id]
  else next[id] = v
  return next
}

// Issues that point at `issueId` through a relation, as inverse relations.
export function inverseRelations(data: AppData, issueId: string): { type: 'blocked_by' | 'duplicated_by' | 'related'; issue: Issue }[] {
  const out: { type: 'blocked_by' | 'duplicated_by' | 'related'; issue: Issue }[] = []
  for (const other of data.issues) {
    for (const r of other.relations) {
      if (r.targetId !== issueId) continue
      if (r.type === 'blocks') out.push({ type: 'blocked_by', issue: other })
      if (r.type === 'duplicate') out.push({ type: 'duplicated_by', issue: other })
      if (r.type === 'related') out.push({ type: 'related', issue: other })
    }
  }
  return out
}
