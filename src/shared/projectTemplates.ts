import type { AppData, Automation, Issue, Project, ProjectTemplate, TriageRule } from './types'

// Snapshot of a project's setup. Issues are optional starter work; cycles and milestone links are left out.
export function projectTemplateFrom(data: AppData, projectId: string, name: string, withIssues: boolean, id: string, now: string): ProjectTemplate {
  const project = data.projects.find(p => p.id === projectId)
  if (!project) throw new Error(`Unknown project ${projectId}`)
  const issues = withIssues ? data.issues.filter(i => i.projectId === projectId) : []
  const kept = new Set(issues.map(i => i.id))
  return structuredClone({
    id,
    name,
    createdAt: now,
    project: { ...project, widths: {}, order: undefined, updates: [], milestones: project.milestones.map(m => ({ ...m, done: false })) },
    automations: data.automations.filter(a => a.projectId === projectId),
    triageRules: data.triageRules.filter(r => r.projectId === projectId),
    issues: issues.map<Issue>(i => ({
      id: i.id,
      projectId,
      number: i.number,
      title: i.title,
      description: i.description,
      status: i.status,
      priority: i.priority,
      assignee: '',
      labels: i.labels,
      estimate: i.estimate,
      values: i.values,
      parentId: i.parentId && kept.has(i.parentId) ? i.parentId : undefined,
      relations: i.relations.filter(r => kept.has(r.targetId)),
      comments: [],
      activity: [],
      createdAt: now,
      updatedAt: now
    }))
  })
}

// Copies a template into a new project. Every id gets a fresh one, so the copy shares none with the source.
export function instantiateProjectTemplate(
  tpl: ProjectTemplate,
  opts: { spaceId: string; name: string; key: string; newId: () => string; now: string }
): { project: Project; automations: Automation[]; triageRules: TriageRule[]; issues: Issue[] } {
  const ids = new Map<string, string>()
  const statuses = new Map<string, string>()
  const mint = (map: Map<string, string>, old: string) => {
    if (!map.has(old)) map.set(old, opts.newId())
  }
  const p = tpl.project
  mint(ids, p.id)
  p.columns.forEach(c => {
    mint(ids, c.id)
    c.options?.forEach(o => mint(ids, o.id))
  })
  p.statuses.forEach(s => mint(statuses, s.id))
  p.milestones.forEach(m => mint(ids, m.id))
  p.views.forEach(v => mint(ids, v.id))
  tpl.automations.forEach(a => mint(ids, a.id))
  tpl.triageRules.forEach(r => mint(ids, r.id))
  tpl.issues.forEach(i => mint(ids, i.id))

  const copy = remapIds({ project: p, automations: tpl.automations, triageRules: tpl.triageRules, issues: tpl.issues }, { ids, statuses })
  return {
    project: { ...copy.project, spaceId: opts.spaceId, name: opts.name, key: opts.key, status: 'planned', initiativeId: undefined },
    automations: copy.automations,
    triageRules: copy.triageRules,
    issues: copy.issues.map((i, n) => ({ ...i, number: n + 1, createdAt: opts.now, updatedAt: opts.now }))
  }
}

interface IdMaps {
  ids: Map<string, string>
  statuses: Map<string, string>
}

// Status ids are short words ('done', 'todo'), so they only change where they are status references.
// Labels and text that happen to read the same are left alone. Returns a new tree.
const STATUS_KEYS = new Set(['status', 'to'])

function remapIds<T>(v: T, m: IdMaps, key = '', parent: Record<string, unknown> = {}): T {
  if (typeof v === 'string') {
    const isStatus = STATUS_KEYS.has(key) || (key === 'value' && parent.key === 'status')
    return ((isStatus ? m.statuses : m.ids).get(v) ?? v) as T
  }
  if (Array.isArray(v)) return v.map(x => remapIds(x, m, key, parent)) as T
  if (!v || typeof v !== 'object') return v
  const obj = v as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(obj).map(([k, x]) => {
      // wipLimits is keyed by status id. A status definition's own id is one too.
      if (key === 'wipLimits') return [m.statuses.get(k) ?? k, x]
      return [m.ids.get(k) ?? k, remapIds(x, m, key === 'statuses' && k === 'id' ? 'status' : k, obj)]
    })
  ) as T
}
