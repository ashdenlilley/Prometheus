import { addDays } from './dates'
import { applyFilter } from './filter'
import { nextOccurrence } from './recurrence'
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
  Initiative,
  Issue,
  Notification,
  Project,
  Relation,
  Space,
  StatusCategory,
  Template,
  TriageRule
} from './types'
import { enforceLabelGroups } from './labels'

// Pure data layer shared by the renderer (UI actions) and the main process (MCP tools, DB).

export type Action =
  | { type: 'load'; data: AppData }
  | { type: 'addSpace'; space: Space }
  | { type: 'patchSpace'; id: string; patch: Partial<Space> }
  | { type: 'deleteSpace'; id: string }
  | { type: 'addInitiative'; initiative: Initiative }
  | { type: 'patchInitiative'; id: string; patch: Partial<Initiative> }
  | { type: 'deleteInitiative'; id: string }
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
  | { type: 'notify'; notification: Notification }
  | { type: 'markNotifications'; read: boolean }
  | { type: 'tick'; today: string }

const mapProject = (s: AppData, id: string, fn: (p: Project) => Project): AppData => ({
  ...s,
  projects: s.projects.map(p => (p.id === id ? fn(p) : p))
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

export function reducer(s: AppData, a: Action): AppData {
  switch (a.type) {
    case 'load':
      return a.data
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
        projects: s.projects.filter(p => p.spaceId !== a.id),
        issues: s.issues.filter(i => !projectIds.includes(i.projectId)),
        cycles: s.cycles.filter(c => !projectIds.includes(c.projectId)),
        automations: s.automations.filter(x => !projectIds.includes(x.projectId)),
        triageRules: s.triageRules.filter(r => !projectIds.includes(r.projectId)),
        templates: s.templates.filter(t => !projectIds.includes(t.projectId))
      }
    }
    case 'addInitiative':
      return { ...s, initiatives: [...s.initiatives, a.initiative] }
    case 'patchInitiative':
      return { ...s, initiatives: s.initiatives.map(i => (i.id === a.id ? { ...i, ...a.patch } : i)) }
    case 'deleteInitiative':
      return {
        ...s,
        initiatives: s.initiatives.filter(i => i.id !== a.id),
        projects: s.projects.map(p => (p.initiativeId === a.id ? { ...p, initiativeId: undefined } : p))
      }
    case 'addProject':
      return { ...s, projects: [...s.projects, a.project] }
    case 'patchProject':
      return mapProject(s, a.id, p => ({ ...p, ...a.patch }))
    case 'deleteProject':
      return {
        ...s,
        projects: s.projects.filter(p => p.id !== a.id),
        issues: s.issues.filter(i => i.projectId !== a.id),
        cycles: s.cycles.filter(c => c.projectId !== a.id),
        automations: s.automations.filter(x => x.projectId !== a.id),
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
    case 'addIssue':
      return { ...s, issues: [...s.issues, intake(s, a.issue)] }
    case 'addIssues':
      return { ...s, issues: [...s.issues, ...a.issues.map(i => intake(s, i))] }
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
      return {
        ...s,
        projects: [...s.projects, a.project],
        automations: [...s.automations, ...a.automations],
        triageRules: [...s.triageRules, ...a.triageRules],
        issues: [...s.issues, ...a.issues]
      }
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
      return runRecurrences(runTimedRules(s, a.today), a.today)
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
  let out = s
  for (const rule of rules) {
    const project = out.projects.find(p => p.id === rule.projectId)
    const candidates = out.issues.filter(i => i.projectId === rule.projectId && i.dueDate && i.dueDate < today)
    for (const issue of candidates) {
      const cat = categoryOf(project, issue.status)
      if (cat === 'completed' || cat === 'canceled') continue
      const key = `${rule.id}:${issue.dueDate}`
      if (issue.firedAutomations?.includes(key)) continue
      out = mapIssue(out, issue.id, i => ({ ...i, firedAutomations: [...(i.firedAutomations ?? []), key] }))
      out = applyAction(out, issue.id, rule.action, rule.name)
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
      description: src.description,
      labels: [...src.labels],
      priority: src.priority,
      assignee: src.assignee,
      estimate: src.estimate,
      dueDate: r.dueInDays === undefined ? undefined : addDays(today, r.dueInDays),
      activity: [{ id: crypto.randomUUID(), at: now, text: `Created from ${issueKey(out, src)} (recurring)` }]
    })
    out = {
      ...out,
      issues: [...out.issues.map(i => (i.id === src.id ? { ...i, recurrence: { ...r, next: nextOccurrence(r, today) } } : i)), copy]
    }
  }
  return out
}

function mapIssue(s: AppData, id: string, fn: (i: Issue) => Issue): AppData {
  return { ...s, issues: s.issues.map(i => (i.id === id ? fn(i) : i)) }
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
  }
}

function runAutomations(s: AppData, before: Issue, after: Issue, project: Project | undefined): AppData {
  if (!project) return s
  const rules = s.automations.filter(r => r.enabled && r.projectId === project.id && triggerFires(r.trigger, before, after))
  return rules.reduce((acc, rule) => applyAction(acc, after.id, rule.action, rule.name), s)
}

function applyAction(s: AppData, issueId: string, action: AutomationAction, ruleName: string): AppData {
  const issue = s.issues.find(i => i.id === issueId)
  if (!issue) return s
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
      // Follow-up work becomes a sub-issue of the item that triggered it.
      const project = s.projects.find(p => p.id === issue.projectId)
      const child = createIssue(s, issue.projectId, action.title, {
        status: action.status ?? project?.statuses[0]?.id ?? 'backlog',
        parentId: issueId
      })
      return { ...s, issues: [...s.issues, child] }
    }
    case 'notify':
      return {
        ...s,
        notifications: [
          { id: crypto.randomUUID(), at: new Date().toISOString(), text: `${action.message} (${ruleName})`, issueId, read: false },
          ...s.notifications
        ].slice(0, 200)
      }
  }
}

export function createIssue(data: AppData, projectId: string, title: string, patch: Partial<Issue> = {}): Issue {
  const now = new Date().toISOString()
  const number = data.issues.filter(i => i.projectId === projectId).reduce((m, i) => Math.max(m, i.number), 0) + 1
  return {
    id: crypto.randomUUID(),
    projectId,
    number,
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
  return `${project?.key ?? 'ISS'}-${issue.number}`
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
