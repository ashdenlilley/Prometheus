import type { Issue } from '@shared/types'

export const uid = () => crypto.randomUUID()

export function toISO(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export const todayISO = () => toISO(new Date())

export function parseISO(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: string, n: number) {
  const d = parseISO(s)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export function dayDiff(a: string, b: string) {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000)
}

export function fmtDate(s: string) {
  return parseISO(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function clsx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export function projectKey(name: string) {
  return name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'PRJ'
}

// Canceled issues are excluded from progress, matching Linear's behaviour.
export function progress(issues: Issue[]) {
  const live = issues.filter(i => i.status !== 'canceled')
  const done = live.filter(i => i.status === 'done').length
  return { done, total: live.length, pct: live.length ? Math.round((done / live.length) * 100) : 0 }
}
