// Local-calendar date helpers. Dates are stored as YYYY-MM-DD strings.

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
