// OS-360: pure access rules for roles and restricted projects. No I/O, so main and renderer can share them.
import type { ColumnAccess, ProjectAccess } from './types'

export type { ColumnAccess, ProjectAccess } from './types'

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

// OS-464: per-custom-column rules by role. The owner, and local-only workspaces (role null), always edit.
export type ColumnMode = 'edit' | 'read' | 'hidden'
type AccessCol = { id: string; access?: ColumnAccess }
const COLUMN_OWNER_ONLY = 'only the owner can change column permissions or restricted columns'
const hasRole = (list: string[] | undefined, role: Role) => !!list?.includes(role)
const ruled = (c?: AccessCol) => !!(c?.access?.readOnlyFor?.length || c?.access?.hiddenFor?.length)
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export function columnMode(role: Role | null, col: { access?: ColumnAccess }): ColumnMode {
  if (role === null || role === 'owner') return 'edit'
  if (hasRole(col.access?.hiddenFor, role)) return 'hidden'
  if (role === 'viewer' || hasRole(col.access?.readOnlyFor, role)) return 'read'
  return 'edit'
}

const COLUMN_ROLES = ['member', 'guest', 'viewer']
const isRoleList = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 3 && v.every(r => COLUMN_ROLES.includes(r)))
export function isColumnAccess(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v !== 'object') return false
  const a = v as Record<string, unknown>
  return isRoleList(a.readOnlyFor) && isRoleList(a.hiddenFor)
}

// undefined, null, '' and [] all mean "no value"; other values compare as JSON with sorted keys
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
const stable = (v: unknown) => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x)
export function sameValue(a: unknown, b: unknown): boolean {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b)
  return stable(a) === stable(b)
}

// Returns the reason a row's values break column rules, or null when allowed.
export function valuesError(role: Role, cols: { id: string; name: string; access?: ColumnAccess }[],
  before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): string | null {
  if (role === 'owner') return null
  for (const c of cols) {
    const mode = columnMode(role, c)
    if (mode === 'read' && !sameValue(before?.[c.id], after?.[c.id])) return `the ${c.name} column is read-only for ${role}s`
    if (mode === 'hidden' && after && hasOwn(after, c.id) && !sameValue(before?.[c.id], after[c.id])) return `the ${c.name} column is hidden from ${role}s`
  }
  return null
}

// Keeps hidden values as they were, so a write cannot change or see them
export function mergeHidden(role: Role, cols: AccessCol[], before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const hidden = cols.filter(c => columnMode(role, c) === 'hidden').map(c => c.id)
  if (!hidden.length || !after) return after
  const out = { ...after }
  for (const id of hidden) {
    if (before && hasOwn(before, id)) out[id] = before[id]
    else delete out[id]
  }
  return out
}

export function stripHidden(role: Role, cols: AccessCol[], values: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const hidden = cols.filter(c => columnMode(role, c) === 'hidden').map(c => c.id).filter(id => values && hasOwn(values, id))
  if (!values || !hidden.length) return values
  const out = { ...values }
  for (const id of hidden) delete out[id]
  return out
}

// Non-owners may not add, remove or change a column that has rules in either version
export function columnsError(role: Role, before: AccessCol[] | undefined, after: AccessCol[] | undefined): string | null {
  if (role === 'owner') return null
  const a = new Map((before ?? []).map(c => [c.id, c]))
  const b = new Map((after ?? []).map(c => [c.id, c]))
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(id), y = b.get(id)
    if ((ruled(x) || ruled(y)) && !sameValue(x, y)) return COLUMN_OWNER_ONLY
  }
  return null
}

export function hasColumnRules(cols: AccessCol[]): boolean {
  return cols.some(ruled)
}

// True when any restricted column's rule differs between the two versions
export function accessChanged(before: AccessCol[] | undefined, after: AccessCol[] | undefined): boolean {
  const map = (cs?: AccessCol[]) => Object.fromEntries((cs ?? []).filter(ruled).map(c => [c.id, c.access]))
  return !sameValue(map(before), map(after))
}
