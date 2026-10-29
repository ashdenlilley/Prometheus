// Time-tracking timers. A running timer is stored on the issue (column and start time), so it survives a restart.
// The cell value stays a number of hours, so manual entry and the timer add up.
import type { Issue } from './types'

const round2 = (n: number) => Math.round(n * 100) / 100

export function elapsedHours(start: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(start).getTime()) / 3_600_000)
}

function storedHours(issue: Issue, columnId: string): number {
  const v = issue.values[columnId]
  return typeof v === 'number' ? v : 0
}

// Stored hours plus the running session, when the timer is on this column.
export function trackedHours(issue: Issue, columnId: string, now: Date): number {
  const base = storedHours(issue, columnId)
  return issue.timer?.columnId === columnId ? base + elapsedHours(issue.timer.start, now) : base
}

// Adds the running session (rounded to 0.01) to its column and clears the timer. Empty when no timer runs.
export function stopTimer(issue: Issue, now: Date): Partial<Issue> {
  if (!issue.timer) return {}
  const { columnId, start } = issue.timer
  const total = round2(storedHours(issue, columnId) + round2(elapsedHours(start, now)))
  return { values: { ...issue.values, [columnId]: total }, timer: undefined }
}

// Starts a timer on the column. A timer running on another column stops first, so its time is kept.
export function startTimer(issue: Issue, columnId: string, now: Date): Partial<Issue> {
  if (issue.timer?.columnId === columnId) return {}
  return { ...stopTimer(issue, now), timer: { columnId, start: now.toISOString() } }
}

// h:mm:ss for a running session.
export function formatElapsed(hours: number): string {
  const s = Math.floor(hours * 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}
