// OS-360: pure access rules for roles and restricted projects. No I/O, so main and renderer can share them.
import type { ProjectAccess } from './types'

export type { ProjectAccess } from './types'

export type Role = 'owner' | 'member' | 'viewer' | 'guest'
export const ROLES: Role[] = ['owner', 'member', 'viewer', 'guest']

export interface Principal {
  userId: string
  role: Role
  projects: string[] // guest's granted project ids; ignored for other roles
}

// Sync table name -> field that points at the project / issue
export const PROJECT_SCOPE: Record<string, string> = {
  issues: 'projectId', cycles: 'projectId', automations: 'projectId', triage_rules: 'projectId',
  templates: 'projectId', webhooks: 'projectId', docs: 'projectId', integrations: 'scopeId'
}
export const ISSUE_SCOPE: Record<string, string> = { git_links: 'issueId', notifications: 'issueId' }

// Tables that cause outbound effects, so only the owner may change them
export const OWNER_ONLY_TABLES = new Set(['webhooks', 'integrations', 'agents'])
// Unscoped tables guests may read so their granted projects render
export const GUEST_READ_TABLES = new Set(['spaces', 'teams'])
export const GUEST_WRITE_TABLES = new Set(['issues', 'docs', 'git_links'])

const GUEST_WRITE_ONLY = 'guests can only edit issues and docs in their projects'

export function isProjectAccess(v: unknown): v is ProjectAccess {
  if (!v || typeof v !== 'object') return false
  const a = v as Record<string, unknown>
  return (a.mode === 'open' || a.mode === 'restricted') && Array.isArray(a.users) && a.users.length <= 500
    && a.users.every(u => typeof u === 'string' && u.length > 0)
}

export function canSeeProject(p: Principal, projectId: string, access?: ProjectAccess | null): boolean {
  if (p.role === 'owner') return true
  if (access?.mode === 'restricted' && !access.users.includes(p.userId)) return false
  if (p.role === 'guest' && !p.projects.includes(projectId)) return false
  return true
}

// project: resolved project id the row belongs to (for 'projects' it is the row id); null = workspace-level row
export interface RowScope { project: string | null; access?: ProjectAccess | null }

export function canReadRow(p: Principal, table: string, scope: RowScope): boolean {
  if (p.role === 'owner') return true
  if (scope.project !== null) return canSeeProject(p, scope.project, scope.access)
  return p.role !== 'guest' || GUEST_READ_TABLES.has(table)
}

// Returns the reason a write is refused, or null when allowed.
// before = scope of the existing row (null if new); after = scope after the op (null for delete).
export function writeError(p: Principal, table: string, fields: string[], before: RowScope | null, after: RowScope | null): string | null {
  if (p.role === 'owner') return null
  if (p.role === 'viewer') return 'viewers have read-only access'
  if (OWNER_ONLY_TABLES.has(table)) return `only the owner can change ${table}`
  if (table === 'projects' && fields.includes('access')) return 'only the owner can change project access'
  if (p.role === 'guest' && (!GUEST_WRITE_TABLES.has(table) || before?.project === null || after?.project === null)) return GUEST_WRITE_ONLY
  if (before && !canReadRow(p, table, before)) return 'that row is not visible to you'
  if (after && !canReadRow(p, table, after)) return 'that project is not visible to you'
  return null
}

export function canManageMembers(p: Principal): boolean {
  return p.role === 'owner'
}

const LABELS: Record<Role, string> = { owner: 'Owner', member: 'Member', viewer: 'Viewer (read only)', guest: 'Guest' }
export function roleLabel(r: Role): string {
  return LABELS[r]
}
