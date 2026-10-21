export { addDays, dayDiff, parseISO, todayISO, toISO } from '@shared/dates'

export const uid = () => crypto.randomUUID()

export function fmtDate(s: string) {
  return new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function clsx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export function projectKey(name: string) {
  return name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'PRJ'
}
