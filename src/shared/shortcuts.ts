export const DRAWER_SHORTCUTS = [
  { key: 's', label: 'status' },
  { key: 'p', label: 'priority' },
  { key: 'f', label: 'favourite' },
  { key: 'l', label: 'labels' },
  { key: 'a', label: 'assignee' }
] as const

export type DrawerKey = (typeof DRAWER_SHORTCUTS)[number]['key']

// Mod+Shift+. copies the branch name. `code` is checked because Shift turns the key into '>'.
export const isCopyBranchShortcut = (e: { code: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; typing: boolean }) =>
  !e.typing && !!(e.metaKey || e.ctrlKey) && !!e.shiftKey && !e.altKey && e.code === 'Period'

// Lower-case only, so Shift+letter (e.g. 'L') never triggers a shortcut.
export const drawerShortcut = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; typing: boolean }): DrawerKey | null => {
  if (e.typing || e.metaKey || e.ctrlKey || e.altKey) return null
  return DRAWER_SHORTCUTS.find(s => s.key === e.key)?.key ?? null
}
