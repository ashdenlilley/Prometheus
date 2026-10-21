import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { STATUSES, type Issue, type Project } from '@shared/types'
import { issueKey, useStore } from '../store'
import { addDays, dayDiff, parseISO, todayISO } from '../util'

export const LABEL_W = 260
const DAY = 28

// Shared row layout for timeline and roadmap: sticky label column plus a track.
export function Row({
  label,
  width,
  todayX,
  className,
  children
}: {
  label: ReactNode
  width: number
  todayX?: number
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={`tl-row ${className ?? ''}`} style={{ width: LABEL_W + width }}>
      <div className="tl-label">{label}</div>
      <div className="tl-track" style={{ width }}>
        {todayX !== undefined && <div className="tl-today" style={{ left: todayX }} />}
        {children}
      </div>
    </div>
  )
}

export function TimelineView({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const { data } = useStore()
  const scroller = useRef<HTMLDivElement>(null)
  const today = todayISO()
  const issues = data.issues.filter(i => i.projectId === project.id)
  const dated = issues.filter(
    (i): i is Issue & { startDate: string; dueDate: string } => !!i.startDate && !!i.dueDate
  )
  const cycles = data.cycles.filter(c => c.projectId === project.id)

  const first = [today, ...dated.map(i => i.startDate), ...cycles.map(c => c.startDate)].reduce((a, b) =>
    a < b ? a : b
  )
  const last = [today, ...dated.map(i => i.dueDate), ...cycles.map(c => c.endDate)].reduce((a, b) => (a > b ? a : b))
  const origin = addDays(first, -3)
  const days = dayDiff(origin, addDays(last, 7)) + 1
  const width = days * DAY
  const x = (d: string) => dayDiff(origin, d) * DAY
  const span = (a: string, b: string) => (dayDiff(a, b) + 1) * DAY
  const todayX = x(today) + DAY / 2
  const dayCells = Array.from({ length: days }, (_, n) => addDays(origin, n))

  useLayoutEffect(() => {
    scroller.current?.scrollTo({ left: Math.max(0, LABEL_W + todayX - 400) })
  }, [project.id])

  return (
    <div className="timeline" ref={scroller}>
      <Row label="Item" width={width} className="tl-head">
        {dayCells.map((d, n) => {
          const d0 = parseISO(d)
          const showMonth = n === 0 || d0.getDate() === 1
          return (
            <div key={d} className="tl-day" style={{ left: n * DAY, width: DAY }}>
              {showMonth && d0.toLocaleDateString(undefined, { month: 'short' }) + ' '}
              {d0.getDate()}
            </div>
          )
        })}
      </Row>

      {cycles.map(c => (
        <Row key={c.id} label={<b>{c.name}</b>} width={width} todayX={todayX}>
          <div className="tl-cycle" style={{ left: x(c.startDate), width: span(c.startDate, c.endDate) }} />
        </Row>
      ))}

      {dated.map(i => {
        const color = STATUSES.find(s => s.id === i.status)!.color
        return (
          <Row
            key={i.id}
            label={
              <>
                <span className="muted">{issueKey(data, i)}</span> {i.title}
              </>
            }
            width={width}
            todayX={todayX}
          >
            <div
              className="tl-bar"
              style={{ left: x(i.startDate), width: span(i.startDate, i.dueDate), background: color }}
              onClick={() => onOpen(i.id)}
            >
              {i.title}
            </div>
          </Row>
        )
      })}

      {issues.length > dated.length && (
        <div className="muted pad">{issues.length - dated.length} issues without start/due dates are not shown.</div>
      )}
    </div>
  )
}
