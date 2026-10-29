export const DRAWER_SHORTCUTS = [
  { key: 's', label: 'status' },
  { key: 'p', label: 'priority' },
  { key: 'f', label: 'favourite' },
  { key: 'l', label: 'labels' },
  { key: 'a', label: 'assignee' }
] as const

export type DrawerKey = (typeof DRAWER_SHORTCUTS)[number]['key']

// Lower-case only, so Shift+letter (e.g. 'L') never triggers a shortcut.
export const drawerShortcut = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; typing: boolean }): DrawerKey | null => {
  if (e.typing || e.metaKey || e.ctrlKey || e.altKey) return null
  return DRAWER_SHORTCUTS.find(s => s.key === e.key)?.key ?? null
}
