// Date column values. Stored as 'YYYY-MM-DD' (date only) or an ISO timestamp (date and time).
// Local-time input and comparison helpers live here so the renderer, sort and filter agree.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const pad = (n: number) => String(n).padStart(2, '0')

// ISO or YYYY-MM-DD -> 'YYYY-MM-DDTHH:mm' in local time (what datetime-local expects).
export function toLocalInput(value: string): string {
  if (DATE_ONLY.test(value)) return `${value}T00:00`
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 'YYYY-MM-DDTHH:mm' local -> ISO timestamp.
export function fromLocalInput(local: string): string {
  if (!local) return ''
  const d = new Date(local)
  return isNaN(d.getTime()) ? '' : d.toISOString()
}

// Comparable epoch ms. Date-only is local midnight; NaN for invalid input.
export function dateValueMs(value: string): number {
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d).getTime()
  }
  return Date.parse(value)
}
