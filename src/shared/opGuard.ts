// OS-464: the role and column rules a cloud workspace enforces on each op. Agent writes run through this
// before they apply locally, so a refused write never reaches the store. The server checks the same rules.
import type { AppData, Column, ProjectAccess } from './types'
import { ISSUE_SCOPE, PROJECT_SCOPE, columnsError, valuesError, writeError, type Principal, type RowScope } from './permissions'
import { TABLE_KEYS, type Op } from './sync'

type Row = Record<string, unknown>

// The project a row sits in, with that project's access rules. No project when it is unknown.
function inProject(prev: AppData, projectId: unknown): RowScope {
  const project = prev.projects.find(p => p.id === projectId)
  return project ? { project: project.id, access: project.access ?? null } : { project: null }
}

function scopeOf(prev: AppData, table: string, row: Row): RowScope {
  if (table === 'projects') return { project: String(row.id), access: (row.access ?? null) as ProjectAccess | null }
  if (PROJECT_SCOPE[table]) return inProject(prev, row[PROJECT_SCOPE[table]])
  if (ISSUE_SCOPE[table]) return inProject(prev, prev.issues.find(i => i.id === row[ISSUE_SCOPE[table]])?.projectId)
  return { project: null }
}

// Returns the first reason the ops are refused for `p`, or null when all are allowed.
export function opsError(p: Principal, prev: AppData, ops: Op[]): string | null {
  if (p.role === 'owner') return null
  for (const op of ops) {
    const key = TABLE_KEYS.find(([t]) => t === op.table)?.[1]
    if (!key) return `Not allowed: unknown table ${op.table}`
    const old = ((prev[key] ?? []) as unknown as Row[]).find(r => r.id === op.id)
    const row: Row | null = op.del ? null : { ...old, ...op.set }
    for (const f of op.unset ?? []) if (row) delete row[f]
    const before = old ? scopeOf(prev, op.table, old) : null
    const after = row ? scopeOf(prev, op.table, row) : null
    const fields = [...Object.keys(op.set ?? {}), ...(op.unset ?? [])]
    let reason = writeError(p, op.table, fields, before, after)
    if (!reason && op.set && op.table === 'issues' && 'values' in op.set && row) {
      const cols = prev.projects.find(x => x.id === row.projectId)?.columns ?? []
      reason = valuesError(p.role, cols, old?.values as Row | undefined, op.set.values as Row)
    }
    if (!reason && op.set && op.table === 'projects' && 'columns' in op.set) {
      reason = columnsError(p.role, old?.columns as Column[] | undefined, op.set.columns as Column[])
    }
    if (reason) return `Not allowed: ${reason}`
  }
  return null
}
