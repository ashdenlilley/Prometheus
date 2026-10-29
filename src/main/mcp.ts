import http from 'http'
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { join } from 'path'
import { promises as fs } from 'fs'
import { type AppData, type Issue, type Project, type RelationType, type StatusDef } from '../shared/types'
import { categoryOf, createIssue, issueKey, reducer, type Action } from '../shared/model'
import { blankProject } from '../shared/seed'
import { progress } from '../shared/query'
import { submissionToIssue } from '../shared/forms'

// Local MCP server (streamable HTTP, JSON responses only). Binds to 127.0.0.1 and requires a bearer token.

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26']
const DEFAULT_PORT = 7878
const PORT_TRIES = 8
const MAX_BODY = 1024 * 1024

export interface McpHost {
  read(): AppData | null
  apply(action: Action): void
}

interface McpConfig {
  enabled: boolean
  token: string
  port: number
}

export interface McpStatus {
  enabled: boolean
  running: boolean
  url: string
  token: string
  port: number
}

interface ToolContext {
  data: AppData
  apply: (action: Action) => void
}

interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>, ctx: ToolContext) => unknown
}

const str = (description: string) => ({ type: 'string', description })
const num = (description: string) => ({ type: 'number', description })
const statusProp = { type: 'string', description: 'Status id from get_project statuses, e.g. in_progress' }
const issueRef = {
  id: str('Issue UUID'),
  key: str('Issue key such as PRM-12. Use either id or key.')
}

// ───────────── Lookups ─────────────

function findIssue(data: AppData, args: Record<string, unknown>): Issue {
  if (typeof args.id === 'string') {
    const hit = data.issues.find(i => i.id === args.id)
    if (hit) return hit
  }
  if (typeof args.key === 'string') {
    // Matches the displayed key, which is the team key for newer issues
    const key = args.key.trim().toLowerCase()
    const hit = data.issues.find(i => issueKey(data, i).toLowerCase() === key)
    if (hit) return hit
  }
  throw new Error('Issue not found. Pass a valid id or key such as PRM-12.')
}

function findProject(data: AppData, args: Record<string, unknown>) {
  const ref = typeof args.projectId === 'string' ? args.projectId : typeof args.key === 'string' ? args.key : ''
  const project = data.projects.find(p => p.id === ref || p.key.toLowerCase() === ref.toLowerCase())
  if (!project) throw new Error('Project not found. Pass projectId or project key.')
  return project
}

function requireString(args: Record<string, unknown>, name: string): string {
  const v = args[name]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required`)
  return v.trim()
}

function requireStatus(project: Project, v: unknown): string {
  if (typeof v !== 'string' || !project.statuses.some(s => s.id === v)) {
    throw new Error(`status must be one of: ${project.statuses.map(s => s.id).join(', ')}`)
  }
  return v
}

function issueView(data: AppData, i: Issue) {
  const project = data.projects.find(p => p.id === i.projectId)
  return {
    id: i.id,
    key: issueKey(data, i),
    title: i.title,
    description: i.description,
    status: i.status,
    priority: i.priority,
    assignee: i.assignee,
    labels: i.labels,
    estimate: i.estimate ?? null,
    parentId: i.parentId ?? null,
    milestoneId: i.milestoneId ?? null,
    triage: !!i.triage,
    archivedAt: i.archivedAt ?? null,
    cycleId: i.cycleId ?? null,
    startDate: i.startDate ?? null,
    dueDate: i.dueDate ?? null,
    values: i.values,
    relations: i.relations.map(r => ({ type: r.type, key: keyOf(data, r.targetId) })),
    comments: i.comments.length,
    category: categoryOf(project, i.status),
    updatedAt: i.updatedAt
  }
}

function keyOf(data: AppData, id: string) {
  const i = data.issues.find(x => x.id === id)
  return i ? issueKey(data, i) : id
}

// Fields shared by create_issue and update_issue.
function issuePatch(project: Project | undefined, data: AppData, args: Record<string, unknown>): Partial<Issue> {
  const patch: Partial<Issue> = {}
  if (args.title !== undefined) patch.title = requireString(args, 'title')
  if (args.description !== undefined) patch.description = String(args.description)
  if (args.status !== undefined) patch.status = project ? requireStatus(project, args.status) : String(args.status)
  if (args.priority !== undefined) {
    const p = Number(args.priority)
    if (!Number.isInteger(p) || p < 0 || p > 4) throw new Error('priority must be 0 (none) to 4 (low)')
    patch.priority = p
  }
  if (args.assignee !== undefined) patch.assignee = String(args.assignee)
  if (args.labels !== undefined) patch.labels = (args.labels as unknown[]).map(String)
  if (args.estimate !== undefined) patch.estimate = args.estimate === null || args.estimate === '' ? undefined : Number(args.estimate)
  if (args.startDate !== undefined) patch.startDate = String(args.startDate) || undefined
  if (args.dueDate !== undefined) patch.dueDate = String(args.dueDate) || undefined
  if (args.cycleId !== undefined) patch.cycleId = String(args.cycleId) || undefined
  if (args.milestoneId !== undefined) patch.milestoneId = String(args.milestoneId) || undefined
  if (args.triage !== undefined) patch.triage = Boolean(args.triage)
  if (args.archived !== undefined) patch.archivedAt = args.archived ? new Date().toISOString() : undefined
  if (args.parentKey !== undefined) {
    patch.parentId = args.parentKey ? findIssue(data, { key: String(args.parentKey) }).id : undefined
  }
  return patch
}

const RELATION_TYPES: RelationType[] = ['blocks', 'duplicate', 'related']

// ───────────── Tools ─────────────

const TOOLS: Tool[] = [
  {
    name: 'list_spaces',
    description: 'List spaces with their project counts.',
    inputSchema: { type: 'object', properties: {} },
    run: (_a, { data }) =>
      data.spaces.map(s => ({ id: s.id, name: s.name, projects: data.projects.filter(p => p.spaceId === s.id).length }))
  },
  {
    name: 'create_space',
    description: 'Create a space that groups projects.',
    inputSchema: {
      type: 'object',
      properties: { name: str('Space name'), color: str('Hex colour, e.g. #5e6ad2') },
      required: ['name']
    },
    run: (a, { apply }) => {
      const space = { id: crypto.randomUUID(), name: requireString(a, 'name'), color: String(a.color ?? '#5e6ad2') }
      apply({ type: 'addSpace', space })
      return space
    }
  },
  {
    name: 'create_initiative',
    description: 'Create an initiative (a goal that groups projects in a space).',
    inputSchema: {
      type: 'object',
      properties: { spaceId: str('Space id'), name: str('Name'), targetDate: str('YYYY-MM-DD') },
      required: ['spaceId', 'name']
    },
    run: (a, { data, apply }) => {
      requireString(a, 'spaceId')
      if (!data.spaces.some(s => s.id === a.spaceId)) throw new Error('Space not found')
      const initiative = {
        id: crypto.randomUUID(),
        spaceId: String(a.spaceId),
        name: requireString(a, 'name'),
        color: '#5e6ad2',
        targetDate: a.targetDate ? String(a.targetDate) : undefined,
        status: 'planned' as const
      }
      apply({ type: 'addInitiative', initiative })
      return initiative
    }
  },
  {
    name: 'list_projects',
    description: 'List projects, optionally within one space.',
    inputSchema: { type: 'object', properties: { spaceId: str('Space id') } },
    run: (a, { data }) =>
      data.projects
        .filter(p => !a.spaceId || p.spaceId === a.spaceId)
        .map(p => {
          const issues = data.issues.filter(i => i.projectId === p.id)
          return {
            id: p.id,
            key: p.key,
            name: p.name,
            spaceId: p.spaceId,
            status: p.status,
            issues: issues.length,
            done: issues.filter(i => categoryOf(p, i.status) === 'completed').length
          }
        })
  },
  {
    name: 'create_project',
    description: 'Create a project inside a space. Key is derived from the name.',
    inputSchema: {
      type: 'object',
      properties: {
        spaceId: str('Space id'),
        name: str('Project name'),
        color: str('Hex colour'),
        startDate: str('YYYY-MM-DD'),
        targetDate: str('YYYY-MM-DD'),
        lead: str('Lead name'),
        initiativeId: str('Initiative id')
      },
      required: ['spaceId', 'name']
    },
    run: (a, { data, apply }) => {
      requireString(a, 'spaceId')
      if (!data.spaces.some(s => s.id === a.spaceId)) throw new Error('Space not found')
      const name = requireString(a, 'name')
      const project = blankProject({
        id: crypto.randomUUID(),
        spaceId: String(a.spaceId),
        name,
        key: name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'PRJ',
        color: String(a.color ?? '#5e6ad2'),
        startDate: a.startDate ? String(a.startDate) : undefined,
        targetDate: a.targetDate ? String(a.targetDate) : undefined,
        lead: a.lead ? String(a.lead) : '',
        initiativeId: a.initiativeId ? String(a.initiativeId) : undefined
      })
      apply({ type: 'addProject', project })
      return { id: project.id, key: project.key, name: project.name, spaceId: project.spaceId }
    }
  },
  {
    name: 'update_project',
    description: 'Update project status, lead, dates, initiative or cycle settings.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: str('Project id or key'),
        status: { type: 'string', enum: ['planned', 'in_progress', 'paused', 'completed', 'canceled'] },
        lead: str('Lead name'),
        startDate: str('YYYY-MM-DD or empty'),
        targetDate: str('YYYY-MM-DD or empty'),
        initiativeId: str('Initiative id or empty'),
        cycleLength: num('Cycle length in days'),
        autoCycles: { type: 'boolean', description: 'Create the next cycle automatically' },
        autoRollOver: { type: 'boolean', description: 'Move unfinished issues to the next cycle when a cycle ends' }
      },
      required: ['projectId']
    },
    run: (a, { data, apply }) => {
      const p = findProject(data, a)
      const patch: Partial<Project> = {}
      if (a.status !== undefined) {
        if (typeof a.status !== 'string' || !['planned', 'in_progress', 'paused', 'completed', 'canceled'].includes(a.status)) {
          throw new Error('status must be one of: planned, in_progress, paused, completed, canceled')
        }
        patch.status = a.status as Project['status']
      }
      if (a.lead !== undefined) patch.lead = String(a.lead)
      if (a.startDate !== undefined) patch.startDate = String(a.startDate) || undefined
      if (a.targetDate !== undefined) patch.targetDate = String(a.targetDate) || undefined
      if (a.initiativeId !== undefined) patch.initiativeId = String(a.initiativeId) || undefined
      if (a.cycleLength !== undefined) patch.cycleLength = Number(a.cycleLength)
      if (a.autoCycles !== undefined) patch.autoCycles = Boolean(a.autoCycles)
      if (a.autoRollOver !== undefined) patch.autoRollOver = Boolean(a.autoRollOver)
      apply({ type: 'patchProject', id: p.id, patch })
      return { id: p.id, key: p.key, ...patch }
    }
  },
  {
    name: 'get_project',
    description: 'Project detail: statuses, columns, cycles, milestones and progress.',
    inputSchema: {
      type: 'object',
      properties: { projectId: str('Project id or key') },
      required: ['projectId']
    },
    run: (a, { data }) => {
      const p = findProject(data, { projectId: a.projectId })
      const issues = data.issues.filter(i => i.projectId === p.id)
      const pr = progress(issues, p.statuses)
      return {
        id: p.id,
        key: p.key,
        name: p.name,
        spaceId: p.spaceId,
        status: p.status,
        lead: p.lead,
        startDate: p.startDate ?? null,
        targetDate: p.targetDate ?? null,
        statuses: p.statuses.map(s => ({ id: s.id, label: s.label, category: s.category })),
        columns: p.columns.map(c => ({ id: c.id, name: c.name, type: c.type, options: c.options ?? [] })),
        cycles: data.cycles.filter(c => c.projectId === p.id).map(c => ({ id: c.id, name: c.name, startDate: c.startDate, endDate: c.endDate })),
        milestones: p.milestones,
        progress: { done: pr.done, total: pr.total }
      }
    }
  },
  {
    name: 'list_issues',
    description: 'List issues. Filter by project, space, status, cycle, parent or a text search over title and labels.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: str('Project id or key'),
        spaceId: str('Space id'),
        status: statusProp,
        cycleId: str('Cycle id'),
        parentKey: str('Parent issue key: list its sub-issues'),
        triage: { type: 'boolean', description: 'Only issues in the triage inbox' },
        include_archived: { type: 'boolean', description: 'Include archived issues, which are hidden by default' },
        search: str('Text to match in title or labels'),
        limit: num('Max results, default 100')
      }
    },
    run: (a, { data }) => {
      const projectId = a.projectId ? findProject(data, { projectId: a.projectId }).id : undefined
      const spaceProjects = a.spaceId ? data.projects.filter(p => p.spaceId === a.spaceId).map(p => p.id) : undefined
      const parentId = a.parentKey ? findIssue(data, { key: String(a.parentKey) }).id : undefined
      const q = typeof a.search === 'string' ? a.search.toLowerCase() : ''
      return data.issues
        .filter(i => !projectId || i.projectId === projectId)
        .filter(i => !spaceProjects || spaceProjects.includes(i.projectId))
        .filter(i => !a.status || i.status === a.status)
        .filter(i => !a.cycleId || i.cycleId === a.cycleId)
        .filter(i => !parentId || i.parentId === parentId)
        .filter(i => a.triage === undefined || !!i.triage === a.triage)
        .filter(i => a.include_archived === true || !i.archivedAt)
        .filter(i => !q || i.title.toLowerCase().includes(q) || i.labels.some(l => l.toLowerCase().includes(q)))
        .slice(0, typeof a.limit === 'number' ? a.limit : 100)
        .map(i => issueView(data, i))
    }
  },
  {
    name: 'get_issue',
    description: 'Get one issue by id or key such as PRM-12.',
    inputSchema: { type: 'object', properties: issueRef },
    run: (a, { data }) => issueView(data, findIssue(data, a))
  },
  {
    name: 'create_issue',
    description: 'Create an issue in a project. Pass parentKey to make it a sub-issue. New items may go to triage.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: str('Project id or key'),
        title: str('Issue title'),
        description: str('Description'),
        status: statusProp,
        priority: num('0 none, 1 urgent, 2 high, 3 medium, 4 low'),
        assignee: str('Assignee name'),
        labels: { type: 'array', items: { type: 'string' } },
        estimate: num('Estimate points'),
        startDate: str('YYYY-MM-DD'),
        dueDate: str('YYYY-MM-DD'),
        cycleId: str('Cycle id'),
        milestoneId: str('Milestone id'),
        parentKey: str('Parent issue key, e.g. PRM-3'),
        triage: { type: 'boolean', description: 'Put the issue in the triage inbox' }
      },
      required: ['projectId', 'title']
    },
    run: (a, { data, apply }) => {
      const project = findProject(data, { projectId: a.projectId })
      const patch = issuePatch(project, data, a)
      if (!patch.status) patch.status = project.statuses[0]?.id ?? 'backlog'
      const issue = createIssue(data, project.id, requireString(a, 'title'), patch)
      apply({ type: 'addIssue', issue })
      return issueView({ ...data, issues: [...data.issues, issue] }, issue)
    }
  },
  {
    name: 'list_forms',
    description: 'List a project\'s intake forms with their fields.',
    inputSchema: { type: 'object', properties: { projectId: str('Project id or key') }, required: ['projectId'] },
    run: (a, { data }) =>
      (findProject(data, a).forms ?? []).map(f => ({ id: f.id, name: f.name, description: f.description ?? null, labels: f.labels ?? [], fields: f.fields }))
  },
  {
    name: 'submit_form',
    description: 'Submit a local intake form. The answer becomes an item in the project triage inbox.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: str('Project id or key'),
        form: str('Form name or id'),
        answers: { type: 'object', description: 'Answers keyed by field key, e.g. { "title": "Login fails" }' }
      },
      required: ['projectId', 'form']
    },
    run: (a, { data, apply }) => {
      const project = findProject(data, a)
      const forms = project.forms ?? []
      const form = forms.find(f => f.id === a.form || f.name.toLowerCase() === String(a.form).toLowerCase())
      if (!form) throw new Error(`Form not found. Forms: ${forms.map(f => f.name).join(', ') || 'none'}`)
      const number = data.issues.filter(i => i.projectId === project.id).reduce((m, i) => Math.max(m, i.number), 0) + 1
      const { issue, errors } = submissionToIssue(form, project, (a.answers ?? {}) as Record<string, unknown>, {
        id: randomUUID(),
        number,
        now: new Date().toISOString()
      })
      if (!issue) throw new Error(errors.join('; '))
      apply({ type: 'addIssue', issue })
      return issueView({ ...data, issues: [...data.issues, issue] }, issue)
    }
  },
  {
    name: 'update_issue',
    description: 'Update fields on an issue. Pass only the fields to change. Empty string clears dates, cycle or parent.',
    inputSchema: {
      type: 'object',
      properties: {
        ...issueRef,
        title: str('Title'),
        description: str('Description'),
        status: statusProp,
        priority: num('0 to 4'),
        assignee: str('Assignee'),
        labels: { type: 'array', items: { type: 'string' } },
        estimate: num('Estimate points'),
        startDate: str('YYYY-MM-DD or empty'),
        dueDate: str('YYYY-MM-DD or empty'),
        cycleId: str('Cycle id or empty'),
        milestoneId: str('Milestone id or empty'),
        parentKey: str('Parent issue key or empty'),
        triage: { type: 'boolean', description: 'false accepts the issue out of triage' },
        archived: { type: 'boolean', description: 'true archives the issue, false unarchives it' }
      }
    },
    run: (a, { data, apply }) => {
      const issue = findIssue(data, a)
      const project = data.projects.find(p => p.id === issue.projectId)
      const action = { type: 'patchIssue' as const, id: issue.id, patch: issuePatch(project, data, a) }
      apply(action)
      const next = reducer(data, action)
      return issueView(next, next.issues.find(i => i.id === issue.id) ?? issue)
    }
  },
  {
    name: 'add_comment',
    description: 'Add a comment to an issue. Mentions like @name notify that person in the app.',
    inputSchema: {
      type: 'object',
      properties: { ...issueRef, body: str('Comment text'), author: str('Author name') },
      required: ['body']
    },
    run: (a, { data, apply }) => {
      const issue = findIssue(data, a)
      const body = requireString(a, 'body')
      const author = a.author ? String(a.author) : data.me
      const now = new Date().toISOString()
      apply({ type: 'addComment', issueId: issue.id, comment: { id: crypto.randomUUID(), author, body, at: now } })
      return { key: issueKey(data, issue), author, body, at: now }
    }
  },
  {
    name: 'add_relation',
    description: 'Link two issues. blocks: this issue blocks the target. duplicate: this issue duplicates the target. related: loose link.',
    inputSchema: {
      type: 'object',
      properties: {
        ...issueRef,
        type: { type: 'string', enum: RELATION_TYPES },
        targetKey: str('Target issue key, e.g. PRM-9')
      },
      required: ['type', 'targetKey']
    },
    run: (a, { data, apply }) => {
      const issue = findIssue(data, a)
      const type = String(a.type) as RelationType
      if (!RELATION_TYPES.includes(type)) throw new Error(`type must be one of: ${RELATION_TYPES.join(', ')}`)
      const target = findIssue(data, { key: String(a.targetKey) })
      if (target.id === issue.id) throw new Error('An issue cannot relate to itself')
      apply({ type: 'addRelation', issueId: issue.id, relation: { type, targetId: target.id } })
      return { key: issueKey(data, issue), type, target: issueKey(data, target) }
    }
  },
  {
    name: 'set_issue_value',
    description: 'Set one custom column value on an issue. Value shape depends on column type.',
    inputSchema: {
      type: 'object',
      properties: { ...issueRef, columnId: str('Custom column id from get_project'), value: {} },
      required: ['columnId', 'value']
    },
    run: (a, { data, apply }) => {
      const issue = findIssue(data, a)
      const columnId = requireString(a, 'columnId')
      const values = { ...issue.values, [columnId]: a.value as Issue['values'][string] }
      apply({ type: 'patchIssue', id: issue.id, patch: { values } })
      return { key: issueKey(data, issue), columnId, value: a.value }
    }
  },
  {
    name: 'create_cycle',
    description: 'Create a time-boxed cycle (sprint) in a project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: str('Project id or key'),
        name: str('Cycle name'),
        startDate: str('YYYY-MM-DD'),
        endDate: str('YYYY-MM-DD')
      },
      required: ['projectId', 'name', 'startDate', 'endDate']
    },
    run: (a, { data, apply }) => {
      const project = findProject(data, { projectId: a.projectId })
      const cycle = {
        id: crypto.randomUUID(),
        projectId: project.id,
        name: requireString(a, 'name'),
        startDate: requireString(a, 'startDate'),
        endDate: requireString(a, 'endDate')
      }
      apply({ type: 'addCycle', cycle })
      return cycle
    }
  },
  {
    name: 'list_notifications',
    description: 'Unread notifications (mentions, automation alerts).',
    inputSchema: { type: 'object', properties: {} },
    run: (_a, { data }) => data.notifications.filter(n => !n.read).map(n => ({ ...n, key: n.issueId ? keyOf(data, n.issueId) : null }))
  }
]

// ───────────── JSON-RPC ─────────────

interface RpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const ok = (id: RpcMessage['id'], result: unknown) => ({ jsonrpc: '2.0', id, result })
const fail = (id: RpcMessage['id'], code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

const isMessage = (m: unknown): m is RpcMessage => typeof m === 'object' && m !== null && !Array.isArray(m)

function handle(msg: RpcMessage, host: McpHost): unknown | null {
  if (!isMessage(msg)) return fail(null, -32600, 'Invalid Request')
  // Notifications carry no id and get no response.
  if (msg.id === undefined || msg.method === undefined) return null
  const id = msg.id

  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '')
      return ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'prometheus', version: '0.1.0' }
      })
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const tool = TOOLS.find(t => t.name === name)
      if (!tool) return fail(id, -32602, `Unknown tool: ${name}`)
      const data = host.read()
      if (!data) return ok(id, { content: [{ type: 'text', text: 'Prometheus has not loaded its data yet. Open the app first.' }], isError: true })
      try {
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
        const out = tool.run(args, { data, apply: host.apply })
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] })
      } catch (e) {
        return ok(id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${msg.method}`)
  }
}

// ───────────── HTTP ─────────────

const isLocalHost = (host: string | undefined) => !!host && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)

const isLocalOrigin = (origin: string) => {
  try {
    return isLocalHost(new URL(origin).host)
  } catch {
    return false
  }
}

function tokenMatches(header: string | undefined, token: string) {
  if (!header?.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7))
  const want = Buffer.from(token)
  return given.length === want.length && timingSafeEqual(given, want)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: http.ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
}

function createServer(token: string, host: McpHost) {
  return http.createServer((req, res) => {
    // Never let a request reject unhandled in the main process.
    route(req, res, token, host).catch(() => {
      if (!res.headersSent) send(res, 500, fail(null, -32603, 'Internal error'))
      else res.end()
    })
  })
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, token: string, host: McpHost) {
  // Reject DNS-rebinding and cross-site requests before anything else.
  if (!isLocalHost(req.headers.host)) return send(res, 403, fail(null, -32000, 'Forbidden host'))
  if (req.headers.origin && !isLocalOrigin(req.headers.origin)) {
    return send(res, 403, fail(null, -32000, 'Forbidden origin'))
  }
  if (req.url !== '/mcp') return send(res, 404)
  if (!tokenMatches(req.headers.authorization, token)) {
    return send(res, 401, fail(null, -32001, 'Missing or invalid bearer token'))
  }
  if (req.method !== 'POST') return send(res, 405)

  let parsed: RpcMessage | RpcMessage[]
  try {
    parsed = JSON.parse(await readBody(req))
  } catch {
    return send(res, 400, fail(null, -32700, 'Parse error'))
  }
  // JSON-RPC 2.0: an empty batch is an Invalid Request, answered with one error object.
  if (Array.isArray(parsed) && parsed.length === 0) return send(res, 200, fail(null, -32600, 'Invalid Request'))
  // A single message must be an object; null, numbers and strings are Invalid Request.
  if (!Array.isArray(parsed) && !isMessage(parsed)) return send(res, 400, fail(null, -32600, 'Invalid Request'))

  const batch = Array.isArray(parsed) ? parsed : [parsed]
  const replies = batch.map(m => handle(m, host)).filter(r => r !== null)
  if (replies.length === 0) return send(res, 202)
  return send(res, 200, Array.isArray(parsed) ? replies : replies[0])
}

// ───────────── Controller ─────────────

export class McpController {
  private server: http.Server | null = null
  private port = 0

  constructor(
    private dir: string,
    private host: McpHost
  ) {}

  private get file() {
    return join(this.dir, 'mcp.json')
  }

  private async config(): Promise<McpConfig> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as McpConfig
    } catch {
      const fresh = { enabled: true, token: randomBytes(24).toString('hex'), port: DEFAULT_PORT }
      await this.save(fresh)
      return fresh
    }
  }

  private async save(cfg: McpConfig) {
    await fs.writeFile(this.file, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  }

  async status(): Promise<McpStatus> {
    const cfg = await this.config()
    return {
      enabled: cfg.enabled,
      running: this.server !== null,
      url: `http://127.0.0.1:${this.port || cfg.port}/mcp`,
      token: cfg.token,
      port: this.port || cfg.port
    }
  }

  // Starts on the saved port, or the next free one if it is taken.
  async start() {
    const cfg = await this.config()
    if (!cfg.enabled || this.server) return
    const token = cfg.token
    for (let n = 0; n < PORT_TRIES; n++) {
      const port = cfg.port + n
      const server = createServer(token, this.host)
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(port, '127.0.0.1', () => resolve())
        })
        this.server = server
        this.port = port
        return
      } catch {
        server.close()
      }
    }
    throw new Error(`No free port for MCP between ${cfg.port} and ${cfg.port + PORT_TRIES - 1}`)
  }

  async stop() {
    const server = this.server
    this.server = null
    this.port = 0
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  }

  async setEnabled(enabled: boolean) {
    const cfg = await this.config()
    await this.save({ ...cfg, enabled })
    if (enabled) await this.start()
    else await this.stop()
    return this.status()
  }

  async regenerateToken() {
    const cfg = await this.config()
    await this.save({ ...cfg, token: randomBytes(24).toString('hex') })
    // Restart so the old token stops working.
    await this.stop()
    await this.start()
    return this.status()
  }
}
