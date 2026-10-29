// Audit log: an append-only record of changes, one entry per changed row.
// Design: every change already reaches the main process in one of three places (renderer saves as
// 'ui', MCP writes as 'mcp' with their action type, remote sync as 'sync'), and each one already has
// or can compute the diffOps for it. Entries are derived from those ops. Automation changes made in
// the renderer arrive as 'ui' saves, so they are not tagged 'automation' yet (known limitation).
import type { Op } from './sync'

export type AuditSource = 'ui' | 'mcp' | 'sync' | 'automation' | 'git'

export interface AuditEntry {
  at: string
  source: AuditSource
  action: string
  table: string
  targetId: string
  fields?: string[]
}

export interface AuditRow extends AuditEntry {
  seq: number
}

export interface AuditFilter {
  source?: AuditSource
  table?: string
  q?: string
  limit?: number
  before?: number
}

// Newest entries kept on disk. Older rows are deleted as new ones arrive.
export const AUDIT_LIMIT = 50000

const FIELD_CAP = 20
const CSV_HEADER = ['at', 'source', 'action', 'table', 'targetId', 'fields']

// Notifications stay local to each device, so they are not part of the audit trail.
export function auditEntries(ops: Op[], source: AuditSource, at: string, action?: string): AuditEntry[] {
  return ops
    .filter(op => op.table !== 'notifications')
    .map(op => {
      const fields = [...Object.keys(op.set ?? {}), ...(op.unset ?? [])].slice(0, FIELD_CAP)
      return {
        at,
        source,
        action: action ?? (op.create ? 'create' : op.del ? 'delete' : 'update'),
        table: op.table,
        targetId: op.id,
        ...(fields.length ? { fields } : {})
      }
    })
}

// RFC 4180 quoting: fields with commas, quotes or line breaks are wrapped in quotes, with quotes doubled.
const cell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

export function toCsv(entries: AuditEntry[]): string {
  const rows = entries.map(e => [e.at, e.source, e.action, e.table, e.targetId, (e.fields ?? []).join(';')])
  return [CSV_HEADER, ...rows].map(r => r.map(cell).join(',')).join('\n')
}
