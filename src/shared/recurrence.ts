import { addDays, parseISO } from './dates'
import type { Recurrence } from './types'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// First matching date strictly after `after`. Dates are YYYY-MM-DD, so string order is date order.
export function nextOccurrence(r: Recurrence, after: string): string {
  switch (r.kind) {
    case 'daily':
      return addDays(after, 1)
    case 'interval':
      return addDays(after, Math.max(1, r.every ?? 1))
    case 'weekly': {
      if (!r.weekdays?.length) return addDays(after, 7)
      for (let n = 1; ; n++) {
        const d = addDays(after, n)
        if (r.weekdays.includes(parseISO(d).getDay())) return d
      }
    }
    case 'monthly': {
      const [y, m] = after.split('-').map(Number)
      for (let k = 0; ; k++) {
        const year = y + Math.floor((m - 1 + k) / 12)
        const month = ((m - 1 + k) % 12) + 1
        const lastDay = new Date(year, month, 0).getDate()
        const day = Math.min(Math.max(r.monthDay ?? 1, 1), lastDay)
        const d = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        if (d > after) return d
      }
    }
  }
}

export function describeRecurrence(r: Recurrence): string {
  switch (r.kind) {
    case 'daily':
      return 'Every day'
    case 'weekly':
      return r.weekdays?.length
        ? `Weekly on ${[...r.weekdays].sort((a, b) => a - b).map(d => DAY_NAMES[d]).join(', ')}`
        : 'Weekly'
    case 'monthly':
      return `Monthly on day ${r.monthDay ?? 1}`
    case 'interval': {
      const n = Math.max(1, r.every ?? 1)
      return n === 1 ? 'Every day' : `Every ${n} days`
    }
  }
}

// Same template and period give the same id on every device, so a copy made on two synced devices merges into one.
export function recurrenceCopyId(templateId: string, period: string): string {
  const text = `${templateId}:${period}`
  return `rec-${fnv1a(text, 0x811c9dc5)}-${fnv1a(text, 0x9e3779b9)}`
}

function fnv1a(text: string, seed: number): string {
  let h = seed
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}
