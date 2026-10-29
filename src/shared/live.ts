// Archived issues (auto-archive or manual) are kept but hidden from every view, list and search
// until unarchived. Use this instead of ad-hoc archivedAt checks.
export const isLive = (issue: { archivedAt?: string }): boolean => !issue.archivedAt

// Default value for an automation trigger's value field when the trigger type changes, so a stale
// value from the previous type (e.g. a status id read as a priority) is never saved.
export function triggerDefault(type: string, statuses: { id: string }[]): string {
  if (type === 'status_changed') return statuses[statuses.length - 1]?.id ?? ''
  if (type === 'priority_changed') return '1'
  return ''
}
