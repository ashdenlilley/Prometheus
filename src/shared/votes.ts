import type { CellValue } from './types'

// Vote values were a plain count before per-person votes. A count of n becomes n anonymous votes.
export function voters(value: CellValue | undefined): string[] {
  if (Array.isArray(value)) return value as string[]
  if (typeof value === 'number') return Array.from({ length: value }, () => 'anonymous')
  return []
}

export function toggleVote(value: CellValue | undefined, me: string): string[] {
  const list = voters(value)
  return list.includes(me) ? list.filter(v => v !== me) : [...list, me]
}

export const voteCount = (value: CellValue | undefined): number => voters(value).length
