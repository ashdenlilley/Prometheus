import { blankProject, emptyData } from './seed'
import { DEFAULT_STATUSES, type AppData, type CellValue, type Column } from './types'

// Upgrades any saved file to the current version. Accepts v2, v3 and v4.
export function migrate(raw: unknown): AppData {
  const v = raw as AppData & { version?: number }
  if (v.version === 4) return v

  const legacy = raw as unknown as Record<string, unknown> & AppData
  const base = emptyData()
  const spaces = legacy.spaces ?? [{ id: crypto.randomUUID(), name: 'Workspace', color: '#5e6ad2' }]
  const defaultSpaceId = spaces[0].id

  const projects = legacy.projects.map(p => {
    const columns: Column[] = p.columns.map(c => {
      const old = c as unknown as { type: string; options?: unknown }
      if (old.type !== 'select') return c
      const labels = Array.isArray(old.options) ? (old.options as string[]) : []
      const options = labels.map((label, n) => ({ id: `opt${n}-${label}`, label, color: '#579bfc' }))
      return { ...c, type: 'dropdown' as const, options }
    })
    return blankProject({
      ...p,
      spaceId: p.spaceId ?? defaultSpaceId,
      widths: p.widths ?? {},
      columns
    })
  })

  // Legacy select values stored the label; dropdown values now store the option id.
  // People values were single strings; they become arrays.
  const issues = legacy.issues.map(i => {
    const project = projects.find(p => p.id === i.projectId)
    const values = Object.fromEntries(
      Object.entries(i.values ?? {}).map(([colId, v]) => {
        const col = project?.columns.find(c => c.id === colId)
        if (col?.type === 'dropdown' && typeof v === 'string') {
          return [colId, col.options?.find(o => o.label === v)?.id ?? v]
        }
        if (col?.type === 'people' && typeof v === 'string') return [colId, v ? [v] : []]
        return [colId, v as CellValue]
      })
    )
    return {
      ...i,
      values,
      relations: [],
      comments: [],
      activity: [],
      status: DEFAULT_STATUSES.some(s => s.id === i.status) ? i.status : 'backlog',
    }
  })

  return {
    ...base,
    spaces,
    projects,
    issues,
    cycles: legacy.cycles ?? []
  }
}
