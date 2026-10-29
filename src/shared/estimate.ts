import type { Project } from './types'

// T-shirt sizes are stored as numbers so sums and charts keep working.
export const TSHIRT: [string, number][] = [
  ['XS', 1],
  ['S', 2],
  ['M', 3],
  ['L', 5],
  ['XL', 8]
]

// Non-standard values show the nearest size; ties go to the larger one (4 -> L).
export function formatEstimate(value: number | undefined, scale?: Project['estimateScale']): string {
  if (value === undefined) return ''
  if (scale !== 'tshirt') return String(value)
  let best = TSHIRT[0]
  for (const size of TSHIRT) {
    if (size[1] === value) return size[0]
    if (Math.abs(size[1] - value) <= Math.abs(best[1] - value)) best = size
  }
  return best[0]
}

export function parseEstimate(text: string, scale?: Project['estimateScale']): number | undefined {
  const t = text.trim()
  if (!t) return undefined
  if (scale === 'tshirt') {
    const size = TSHIRT.find(([label]) => label.toLowerCase() === t.toLowerCase())
    if (size) return size[1]
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}
