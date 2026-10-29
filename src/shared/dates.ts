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

// Six Monday-first weeks covering the month (month is 1-based). 42 days always fit any month.
export function monthGrid(year: number, month: number) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const offset = (parseISO(first).getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, n) => addDays(first, n - offset))
}
