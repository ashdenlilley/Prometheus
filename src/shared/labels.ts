import type { AppData, LabelDef, Project } from './types'

// Shared labels of the project's space first, then labels used in the project that are not shared.
export function availableLabels(data: AppData, project: Project | undefined): { name: string; color?: string; group?: string; shared: boolean }[] {
  const shared = (data.spaces.find(sp => sp.id === project?.spaceId)?.labels ?? []).map(d => ({ ...d, shared: true }))
  const seen = new Set(shared.map(l => l.name.toLowerCase()))
  const used = new Set(data.issues.filter(i => i.projectId === project?.id).flatMap(i => i.labels))
  const local: { name: string; shared: boolean }[] = []
  for (const name of used) {
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    local.push({ name, shared: false })
  }
  return [...shared, ...local.sort((a, b) => a.name.localeCompare(b.name))]
}

// Group names used by the space's shared labels, in the order they were first defined.
export function labelGroups(data: AppData, spaceId: string | undefined): string[] {
  const defs = data.spaces.find(sp => sp.id === spaceId)?.labels ?? []
  return [...new Set(defs.map(d => d.group).filter((g): g is string => !!g))]
}

// A group allows one label at a time. The label newly added to the group wins; otherwise the last one listed does.
export function enforceLabelGroups(prev: string[], next: string[], defs: LabelDef[]): string[] {
  const groupOf = (label: string) => defs.find(d => d.name.toLowerCase() === label.toLowerCase())?.group
  const was = new Set(prev.map(l => l.toLowerCase()))
  const kept = new Map<string, string>()
  for (const label of next) {
    const group = groupOf(label)
    if (!group) continue
    const current = kept.get(group)
    if (!current || !was.has(label.toLowerCase()) || was.has(current.toLowerCase())) kept.set(group, label)
  }
  return next.filter(label => {
    const group = groupOf(label)
    return !group || kept.get(group) === label
  })
}
